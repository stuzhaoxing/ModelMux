# 江苏省监测技能竞赛在线答题系统部署手册

## 1. 共享准备

从示例创建环境文件，并至少替换管理员密码、选手 Key 和供应商 Key：

```bash
cp .env.example .env.local
```

生产密钥不要提交到 Git。公网与本地实例使用不同环境文件，建议分别生成选手 Key；如果业务要求同一个 Key，也要由赛事负责人明确管理和回收时间。

## 2. 赛前公网部署

准备一台有公网 IP 的 Linux 服务器，将域名解析到服务器，并创建 `.env.public`：

```dotenv
MODELMUX_DEPLOYMENT_MODE=public
MODELMUX_PUBLIC_BASE_URL=https://debug.example.com
MODELMUX_INTERNAL_BASE_URL=http://10.20.0.1:4000
MODELMUX_EXTERNAL_BASE_URL=https://debug.example.com
MODELMUX_ADMIN_PASSWORD=<strong-password>
MODELMUX_ADMIN_SESSION_SECRET=<openssl-rand-hex-32>
MODELMUX_CLIENT_KEYS=<client-key-1>,<client-key-2>
SILICONFLOW_API_KEYS=<provider-key-1>,<provider-key-2>
MODELMUX_ALLOW_ANONYMOUS=false
MODELMUX_RATE_LIMIT_RPM=60
```

启动：

```bash
MODELMUX_DOMAIN=debug.example.com \
  docker compose -f deploy/docker-compose.public.yml up -d --build
```

Caddy 自动申请 HTTPS 证书并将请求转发到江苏省监测技能竞赛在线答题系统。上线后验证：

```bash
curl https://debug.example.com/health
curl https://debug.example.com/v1/models \
  -H 'Authorization: Bearer <client-key>'
```

正式开赛前，登录 `https://debug.example.com/admin/settings`，关闭“接受模型请求”开关。确认以下结果：

```bash
curl -i https://debug.example.com/v1/models \
  -H 'Authorization: Bearer <client-key>'
curl https://debug.example.com/health
```

第一个请求必须返回 `503 service_suspended`；健康检查保持 HTTP 200，并返回 `status: "suspended"`、`apiReady: false`。停服状态保存在 Docker 数据卷的 `/var/lib/modelmux/gateway-service-state.json`，重启容器不会自动恢复模型 API。管理员后台保持在线，可在比赛结束后从同一页面恢复。

如需连管理后台和健康检查一并撤下，再执行：

```bash
docker compose -f deploy/docker-compose.public.yml down
```

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

如果不用示例 Caddy，而是在已有 Nginx 中部署，需要为 `/v1/chat/completions` 和 `/v1/messages` 端点禁用缓冲并延长读取超时：

```nginx
proxy_buffering off;
proxy_request_buffering off;
proxy_read_timeout 300s;
proxy_send_timeout 300s;
```

不要部署到限制长连接或严格执行时长的 Serverless Function。江苏省监测技能竞赛在线答题系统应运行在常驻 Node.js 进程或容器中。

## 5. 验收清单

- 管理控制台只需要独立管理密码。
- `/` 跳转到选手答题页 `/contestant/questions`，选手 Playground 位于 `/contestant/playground`，API 文档位于 `/contestant/api-docs`，管理员控制台位于 `/admin`，评委工作台位于 `/judge/questions`。
- 管理员总览显示内网和外网入站端口；没有公网入站服务时外网端口显示“未开放”。
- 未登录请求 `/api/admin/status` 和 `/api/admin/competition/users` 均返回 `401`。
- 管理员可创建评委和选手账号，评委与选手可在同一浏览器同时登录。
- 评委发布题目后，已登录选手无需刷新即可收到题目。
- 选手草稿、最终提交和相应时间可在评委端查看；最终提交后不能修改。
- 上传图片实际写入 `MODELMUX_DATA_DIR/uploads`，重启服务后仍可访问。
- 系统设置关闭模型 API 后，OpenAI 与 Claude 兼容模型端点均返回 `503 service_suspended`，管理员后台仍可访问。
- 停服后重启服务，模型 API 仍保持停止；从系统设置重新开启后恢复调用。
- 无选手 Key 的 `/v1/models` 返回 `401`。
- 同一选手 Key 可以调用 OpenAI 兼容接口和 Claude Messages 兼容接口，成功请求共用同一总额度和模型白名单。
- 非白名单模型返回 `400 model_not_allowed`。
- 登录选手可从 Playground 完成文本和 Qwen 图片理解调用；调用前后该选手的 `api_requests_used` 保持不变，频率超限仍返回 `429 rate_limit_exceeded`。
- 普通和 `stream: true` 请求都能完整返回。
- 供应商主路由失败时，在响应开始前切换到备用路由。
- 赛中地址从每台选手终端可达。
- 选手终端无法访问互联网地址。
- Mac mini 自身可以访问所有配置的上游供应商。
- 开赛前公网调试地址已关闭。
