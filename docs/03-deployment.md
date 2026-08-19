# 江苏省监测技能竞赛在线答题系统部署手册

## 1. 共享准备

从示例创建环境文件，并至少替换管理员密码、选手 Key 和供应商 Key：

```bash
cp .env.example .env.local
```

生产密钥不要提交到 Git。公网与本地实例使用不同环境文件，建议分别生成选手 Key；如果业务要求同一个 Key，也要由赛事负责人明确管理和回收时间。

## 2. 赛前公网部署

公网调试实例跑在一台 Linux 服务器上：Next.js standalone 由 systemd 常驻，nginx 终止 TLS 并反向代理到 `127.0.0.1:4000`，构建全部在本地完成，服务器只负责运行。

### 2.1 服务器一次性准备

需要 Node.js 22+、MySQL 8、nginx 和 systemd，域名解析到这台服务器并准备好证书。

```bash
useradd -r -m -d /opt/modelmux -s /usr/sbin/nologin modelmux
mkdir -p /opt/modelmux/data /opt/modelmux/logs
chown -R modelmux:modelmux /opt/modelmux
chmod 700 /opt/modelmux/data /opt/modelmux/logs
```

初始化数据库（把 `scripts/setup-competition-db.sh` 拷到服务器执行；部署包里只带运行期需要的 `start-local.sh`）：

```bash
MODELMUX_DB_PASSWORD='<strong-database-password>' ./setup-competition-db.sh
```

创建 `/opt/modelmux/.env.local`。这个文件由服务器自己维护，`deploy.sh` 绝不覆盖它：

```dotenv
MODELMUX_DEPLOYMENT_MODE=public
MODELMUX_PUBLIC_BASE_URL=https://debug.example.com
MODELMUX_INTERNAL_BASE_URL=http://10.20.0.1:4000
MODELMUX_EXTERNAL_BASE_URL=https://debug.example.com
MODELMUX_ADMIN_PASSWORD=<strong-password>
MODELMUX_ADMIN_SESSION_SECRET=<openssl-rand-hex-32>
MODELMUX_DATABASE_URL=mysql://modelmux:<database-password>@127.0.0.1:3306/modelmux
MODELMUX_DATA_DIR=/opt/modelmux/data
MODELMUX_CLIENT_KEYS=<client-key-1>,<client-key-2>
MODELMUX_ALLOW_ANONYMOUS=false
MODELMUX_RATE_LIMIT_RPM=60
# nginx 覆写了转发头，限流才能按真实来源 IP 计数
MODELMUX_TRUST_PROXY=true
DEEPSEEK_API_KEYS=<provider-key-1>
DASHSCOPE_API_KEYS=<provider-key-1>
SILICONFLOW_API_KEYS=<provider-key-1>,<provider-key-2>
# 应用只监听回环，公网入口由 nginx 提供
HOSTNAME=127.0.0.1
PORT=4000
```

```bash
chown modelmux:modelmux /opt/modelmux/.env.local
chmod 600 /opt/modelmux/.env.local
```

`HOSTNAME` 必须显式写成 `127.0.0.1`：`scripts/start-local.sh` 的默认值是赛场用的 `10.20.0.1`，在公网服务器上会直接绑定失败。

安装 systemd 单元和 nginx 站点，两份参考配置在仓库里：

```bash
cp deploy/modelmux.service.example /etc/systemd/system/modelmux.service
cp deploy/nginx-modelmux.conf.example /etc/nginx/conf.d/modelmux.conf
# 按实际域名和证书路径改完再执行
systemctl daemon-reload && systemctl enable modelmux
nginx -t && systemctl reload nginx
```

nginx 侧只有两处不能省：`proxy_buffering off`（`/v1/*` 的流式响应和考核系统的实时通道都是 SSE，开缓冲会让选手端先掉线再收到迟到的事件）和足够大的 `proxy_read_timeout`（模型思考时间可能到分钟级）。

### 2.2 每次发版

本地执行，需要 `sshpass`、pnpm 11、Node.js 22+，服务器密码放在 `.deploy.local`（被 `.gitignore` 忽略）或 `SERVER_PASS` 环境变量：

```bash
./deploy.sh              # 本地构建 + 上传 + 重启
./deploy.sh --skip-build # 复用上次构建产物
./deploy.sh --logs       # 部署完顺带打印服务日志
```

脚本的动作顺序是：本地 `pnpm build` → 组装 standalone（补 `.next/static` 和 `public/`）→ 打包时剔除 macOS 平台二进制 → `scp` 上传 → 服务器备份现版本、解包、修属主、`systemctl restart` → 本机回环健康检查最多等 40 秒 → 失败则自动回滚到备份并打印 `journalctl` → 成功后再从公网验一次 `/health`。

绝不在服务器上执行 `pnpm build`：服务器只有运行期依赖，构建会因为缺少 devDependencies 和内存不足失败。

上线后验证：

```bash
curl https://debug.example.com/health
curl https://debug.example.com/v1/models \
  -H 'Authorization: Bearer <client-key>'
```

`/health` 的 `status` 有四种：`ok`、`needs_config`（进程起来了但必填配置没写全）、`suspended`（模型 API 被管理员停掉）、`degraded`（考核数据库连不上，同时返回 HTTP 503）。`deploy.sh` 对这四种分别给出提示，`degraded` 会直接判部署失败。

### 2.3 停服与撤下

正式开赛前，登录 `https://debug.example.com/admin/settings`，关闭“接受模型请求”开关。确认以下结果：

```bash
curl -i https://debug.example.com/v1/models \
  -H 'Authorization: Bearer <client-key>'
curl https://debug.example.com/health
```

第一个请求必须返回 `503 service_suspended`；健康检查保持 HTTP 200，并返回 `status: "suspended"`、`apiReady: false`。停服状态保存在 `MODELMUX_DATA_DIR/gateway-service-state.json`（即 `/opt/modelmux/data/gateway-service-state.json`），重启服务不会自动恢复模型 API。管理员后台保持在线，可在比赛结束后从同一页面恢复。

如需连管理后台和健康检查一并撤下：

```bash
systemctl stop modelmux
```

### 2.4 备选：Docker + Caddy

仓库里另外保留了一套容器方案（`deploy/docker-compose.public.yml` 和 `deploy/Caddyfile`），适合换一台干净服务器时快速拉起，Caddy 会自动申请证书：

```bash
MODELMUX_DOMAIN=debug.example.com \
  docker compose -f deploy/docker-compose.public.yml up -d --build
```

当前公网实例用的是上面的 systemd + nginx 方案，两套不要同时开在一台机器上。容器方案的数据目录落在 Docker 卷 `/var/lib/modelmux`，MySQL 需要另行提供。

## 3. Mac mini 本地部署

先在 macOS“系统设置 → 用户与群组”创建名为 `modelmux` 的标准用户，不授予管理员权限。在 Mac mini 安装 Node.js 22+、pnpm 和 MySQL，然后将项目部署到 `/opt/modelmux`。

初始化本地 MySQL：

```bash
brew install mysql
brew services start mysql
cd /opt/modelmux
MODELMUX_DB_PASSWORD='<strong-database-password>' \
  ./scripts/setup-competition-db.sh
```

脚本只创建 `modelmux` 数据库和同名专用用户；表会在应用首次访问考核功能时自动创建。生产环境不要让应用使用 MySQL `root` 账号。

构建 standalone 服务：

```bash
cd /opt/modelmux
pnpm install --frozen-lockfile
pnpm build
mkdir -p .next/standalone/.next logs
cp -R .next/static .next/standalone/.next/static
```

创建 `/opt/modelmux/.env.local`：

```dotenv
MODELMUX_DEPLOYMENT_MODE=local
MODELMUX_PUBLIC_BASE_URL=http://10.20.0.1:4000
MODELMUX_INTERNAL_BASE_URL=http://10.20.0.1:4000
MODELMUX_EXTERNAL_BASE_URL=
MODELMUX_ADMIN_PASSWORD=<strong-password>
MODELMUX_ADMIN_SESSION_SECRET=<openssl-rand-hex-32>
MODELMUX_DATABASE_URL=mysql://modelmux:<database-password>@127.0.0.1:3306/modelmux
MODELMUX_DATA_DIR=/opt/modelmux/data
MODELMUX_CLIENT_KEYS=<competition-client-key>
SILICONFLOW_API_KEYS=<provider-key-1>,<provider-key-2>
MODELMUX_ALLOW_ANONYMOUS=false
HOSTNAME=10.20.0.1
PORT=4000
# 非 Homebrew 默认路径时显式设置，例如 /usr/local/bin/node
MODELMUX_NODE_BINARY=/opt/homebrew/bin/node
```

限制运行目录和密钥文件权限：

```bash
sudo chown -R modelmux:staff /opt/modelmux
sudo chmod 700 /opt/modelmux/logs
sudo mkdir -p /opt/modelmux/data
sudo chown modelmux:staff /opt/modelmux/data
sudo chmod 700 /opt/modelmux/data
sudo chmod 600 /opt/modelmux/.env.local
```

题目和答卷图片不设置应用层大小上限，上传内容会流式写入
`MODELMUX_DATA_DIR/uploads`，实际容量由磁盘剩余空间决定。比赛前应确认数据盘空间并纳入备份。

安装 `launchd` 服务：

```bash
chmod +x /opt/modelmux/scripts/start-local.sh
cp /opt/modelmux/deploy/com.modelmux.gateway.plist.example \
  /Library/LaunchDaemons/com.modelmux.gateway.plist
sudo chown root:wheel /Library/LaunchDaemons/com.modelmux.gateway.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.modelmux.gateway.plist
```

检查：

```bash
sudo launchctl print system/com.modelmux.gateway
curl http://10.20.0.1:4000/health
curl http://10.20.0.1:4000/v1/models \
  -H 'Authorization: Bearer <competition-client-key>'
```

## 4. 流式响应代理

任何反向代理都必须为这三类长连接禁用缓冲并延长读取超时，`deploy/nginx-modelmux.conf.example` 已经按这个要求写好：

| 路径 | 长连接类型 |
| --- | --- |
| `/v1/chat/completions`、`/v1/messages` | 模型 SSE 流式响应 |
| `/api/competition/events` | 考核系统的实时通道，评委发题和模式切换靠它推送 |

```nginx
proxy_buffering off;
proxy_request_buffering off;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
gzip off;
```

`/api/competition/events` 被缓冲住时症状很有迷惑性：选手端顶部先变成"离线"，随后一次性收到堆积的事件。前端会自行退避重连，但代理配置错了重连也救不回来。

不要部署到限制长连接或严格执行时长的 Serverless Function。江苏省监测技能竞赛在线答题系统应运行在常驻 Node.js 进程或容器中。

## 5. 验收清单

- 管理控制台只需要独立管理密码。
- `/` 跳转到选手答题页 `/contestant/questions`，API 文档位于 `/contestant/api-docs`（Playground 是这个页面里的弹窗，旧地址 `/contestant/playground` 会跳转过来），管理员控制台位于 `/admin`，评委工作台位于 `/judge/questions`，评委和选手的登录页统一为 `/login`。
- 管理员总览显示内网和外网入站端口；没有公网入站服务时外网端口显示“未开放”。
- 未登录请求 `/api/admin/status` 和 `/api/admin/competition/users` 均返回 `401`。
- 管理员可创建评委和选手账号。评委和选手共用 `modelmux_competition_session`，同一个浏览器同一时刻只能保持其中一个身份，后登录的会顶掉先登录的；要同时开两端需用两个浏览器或无痕窗口。管理员会话独立，可与任一端并存。
- 评委发布题目后，已登录选手无需刷新即可收到题目。
- 选手草稿、最终提交和相应时间可在评委端查看；最终提交后不能修改。
- 上传图片实际写入 `MODELMUX_DATA_DIR/uploads`，重启服务后仍可访问。
- 系统设置关闭模型 API 后，OpenAI 与 Claude 兼容模型端点均返回 `503 service_suspended`，管理员后台仍可访问。
- 停服后重启服务，模型 API 仍保持停止；从系统设置重新开启后恢复调用。
- 停掉 MySQL 后 `/health` 返回 `503`，`status` 为 `degraded`，`database.reachable` 为 `false`；恢复 MySQL 后重新返回 `200`。
- 选手在答题框输入后不保存直接刷新页面，页面顶部出现"本机存有一份未保存的答案"横幅，点"恢复"回到刷新前的内容，点"丢弃"或直接继续输入都按丢弃处理。
- 重启服务后，选手端和评委端的在线状态在十几秒内自行恢复，不需要手动刷新页面。
- 无选手 Key 的 `/v1/models` 返回 `401`。
- 同一选手 Key 可以调用 OpenAI 兼容接口和 Claude Messages 兼容接口，成功请求共用同一总额度和模型白名单。
- 非白名单模型返回 `400 model_not_allowed`。
- 登录选手可从 API 文档页的 Playground 完成文本和 Qwen 图片理解调用。Playground 用的就是选手自己的 API Key 打同一个网关端点，所以每次成功调用 `api_requests_used` 都 +1（上游失败会退回），测试模式下同时扣减剩余额度；频率超限仍返回 `429 rate_limit_exceeded`。
- 普通和 `stream: true` 请求都能完整返回。
- 供应商主路由失败时，在响应开始前切换到备用路由。
- 赛中地址从每台选手终端可达。
- 选手终端无法访问互联网地址。
- Mac mini 自身可以访问所有配置的上游供应商。
- 开赛前公网调试地址已关闭。
