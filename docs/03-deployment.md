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

需要 Node.js 22+、MySQL 8、nginx、systemd 和 Noto CJK 字体，域名解析到这台服务器并准备好证书。Ubuntu 先安装答卷 PDF 使用的中文字体：

```bash
apt-get update
apt-get install -y fonts-noto-cjk
```

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
# 登录失败保护按真实来源 IP 计数
MODELMUX_TRUST_PROXY=true
DEEPSEEK_API_KEYS=<provider-key-1>
DASHSCOPE_API_KEYS=<provider-key-1>
SILICONFLOW_API_KEYS=<provider-key-1>,<provider-key-2>
# 可选；配置后开放 doubao-seed-2-0-pro-260215
ARK_API_KEYS=<provider-key-1>
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

本地执行，需要 `sshpass`、pnpm 11、Node.js 22+，服务器密码放在 `.deploy.local`（被 `.gitignore` 忽略）或 `MODELMUX_DEPLOY_PASSWORD` 环境变量：

```bash
./deploy.sh              # 本地构建 + 上传 + 重启
./deploy.sh --skip-build # 复用上次构建产物
./deploy.sh --logs       # 部署完顺带打印服务日志
```

脚本的动作顺序是：本地 `pnpm build` → 组装 standalone（补 `.next/static` 和 `public/`）→ 打包时剔除 macOS 产物并校验 Sharp 依赖及 Linux x64 Sharp/libvips → `scp` 上传 → 服务器备份现版本、解包、修属主，并在 Linux 上实际加载一次 Sharp → `systemctl restart` → 本机回环健康检查最多等 40 秒 → 失败则自动回滚到备份并打印 `journalctl` → 成功后再从公网验一次 `/health`。

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
# PDF 导出使用的 CJK 字体（可选；未设置时自动探测系统字体）
MODELMUX_EXPORT_FONT_PATH=/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.otf
# 仅当上面配置的是 TTC 字体集合时填写，例如 NotoSerifCJKsc-Regular
MODELMUX_EXPORT_FONT_FAMILY=
# 考务工作台默认比赛时长，管理员开始比赛时可修改，单位分钟
MODELMUX_COMPETITION_DURATION_MINUTES=90
MODELMUX_CLIENT_KEYS=<competition-client-key>
DASHSCOPE_API_KEYS=<provider-key-1>
SILICONFLOW_API_KEYS=<provider-key-1>,<provider-key-2>
# 可选；配置后开放 doubao-seed-2-0-pro-260215
ARK_API_KEYS=<provider-key-1>
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

题目和答卷里的图片、PDF、Office 文档、压缩包及其他附件都不设置应用层固定大小上限，
上传内容会流式写入 `MODELMUX_DATA_DIR/uploads`，下载也使用文件流。实际容量由浏览器、
磁盘和文件系统决定。比赛前应确认数据盘空间并纳入备份；Nginx 必须同时使用
`client_max_body_size 0` 和 `proxy_request_buffering off`，否则代理仍会限制或完整缓冲大附件。

admin 考务工作台的“导出全部答卷”会为每个启用选手、每道已发布或已关闭题目生成一份 `.docx` 和一份 `.pdf`，再以 ZIP 流式下载。Word 中文使用宋体（SimSun），西文使用 Times New Roman。PDF 需要可被 `fontkit` 识别的 CJK TTF/OTF/TTC；生产 Linux 建议安装 `fonts-noto-cjk` 并将 `MODELMUX_EXPORT_FONT_PATH` 指向 `NotoSerifCJK-Regular.otf` 等宋体类字体。使用 TTC 字体集合时还需通过 `MODELMUX_EXPORT_FONT_FAMILY` 指定其中的简体中文字体，避免选中错误字形或导出失败。导出临时文件写入数据目录，下载连接关闭后自动清理。

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

投屏电脑打开 `http://10.20.0.1:4000/screen` 后，输入与 `MODELMUX_ADMIN_PASSWORD` 相同的单密码。系统签发独立的大屏只读会话，不会授予管理员后台权限；大屏快照接口也验证该会话，不能绕过页面直接读取。页面显示姓名和答题状态，不包含登录账号、答案正文、密码或 API Key。选手区域会自动调整行列，确保全部选手始终同屏展示。

## 4. 流式响应代理

任何反向代理都必须为这两类长连接禁用缓冲并延长读取超时，`deploy/nginx-modelmux.conf.example` 已经按这个要求写好：

| 路径 | 长连接类型 |
| --- | --- |
| `/v1/chat/completions` | 模型 SSE 流式响应 |
| `/api/competition/events` | 考核系统的实时通道，管理员发题和模式切换靠它推送 |

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
- `/` 跳转到选手答题页 `/contestant/questions`，API 文档位于 `/contestant/api-docs`（Playground 是这个页面里的弹窗，旧地址 `/contestant/playground` 会跳转过来）。管理员登录入口是 `/admin/login`；登录后从 `/admin/competition` 进入考务总览，`/admin/questions` 管理题目，`/admin/answers` 查看答卷。旧 `/judge/*` 链接会永久重定向到对应 admin 页面。
- 管理员总览显示内网和外网入站端口；没有公网入站服务时外网端口显示“未开放”。
- 未登录请求 `/api/admin/status` 和 `/api/admin/competition/users` 均返回 `401`。
- 管理员只创建选手账号。考务能力直接使用 `modelmux_admin_session`，不再创建或登录评委账号；已有评委账号与历史记录保留，但旧评委会话会自动撤销。选手继续使用独立的 `modelmux_competition_session`，因此同一浏览器可同时保持 admin 与选手登录。
- 管理员在考务总览填写时长并开始比赛后，已登录选手无需刷新即可同时收到整套题目，大屏倒计时同步开始；停止或自然到时后，选手端隐藏题目并禁止继续保存、提交，历史答案保留。
- 比赛未运行时，管理员可在 `/admin/answers` 删除题目；该题已有草稿和已提交答卷会随题目一并永久删除，进行中的比赛拒绝删除请求。
- 选手草稿、最终提交和相应时间可在 admin 考务工作台查看；最终提交后不能修改。
- 管理员可在题目中、选手可在答卷中上传任意类型附件；文件实际写入 `MODELMUX_DATA_DIR/uploads`，重启服务后仍可下载。
- 管理员在答题进度页点击“导出全部答卷”可下载按选手分目录的 ZIP；每道题同时包含 Word/PDF，未开始作答的选手也会生成“尚未开始作答”文件。
- 系统设置关闭模型 API 后，OpenAI 兼容模型端点返回 `503 service_suspended`，管理员后台仍可访问。
- 停服后重启服务，模型 API 仍保持停止；从系统设置重新开启后恢复调用。
- 停掉 MySQL 后 `/health` 返回 `503`，`status` 为 `degraded`，`database.reachable` 为 `false`；恢复 MySQL 后重新返回 `200`。
- 选手在答题框输入后不保存直接刷新页面，页面顶部出现"本机存有一份未保存的答案"横幅，点"恢复"回到刷新前的内容，点"丢弃"或直接继续输入都按丢弃处理。
- 重启服务后，选手端和 admin 考务工作台的在线状态在十几秒内自行恢复，不需要手动刷新页面。
- 无选手 Key 的 `/v1/models` 返回 `401`。
- 选手 Key 通过 OpenAI 兼容接口调用白名单模型，网关不设置账号额度或调用频率限制。
- 非白名单模型返回 `400 model_not_allowed`。
- 登录选手可从 API 文档页的 Playground 完成文本和 Qwen 图片理解调用。Playground 用选手自己的 API Key 调同一个网关端点，网关不附加额度、RPM 或请求体大小限制。
- 普通和 `stream: true` 请求都能完整返回。
- 供应商主路由失败时，在响应开始前切换到备用路由。
- 赛中地址从每台选手终端可达。
- 选手终端无法访问互联网地址。
- Mac mini 自身可以访问所有配置的上游供应商。
- 开赛前公网调试地址已关闭。
