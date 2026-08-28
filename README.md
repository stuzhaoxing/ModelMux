# 江苏省监测技能竞赛在线答题系统

江苏省监测技能竞赛在线答题系统是面向竞赛场景的自托管答题与大模型网关服务。赛前部署为互联网调试服务，赛中运行在 Mac mini 的隔离局域网；两种环境使用同一套 Next.js 服务、OpenAI 兼容接口和模型白名单，选手只切换 API URL。

## 当前能力

- Next.js 16 管理控制台与 Node.js 网关运行时，首页为选手答题入口
- `GET /health`，覆盖网关配置、停服开关和考核数据库连通性；MySQL 连不上时返回 `503` 且 `status` 为 `degraded`
- `GET /v1/models`
- `POST /v1/chat/completions`，支持普通响应与 SSE 流式透传
- 每位选手独立 API Key 和模型白名单；网关不设置账号调用额度、RPM 或请求体大小上限
- 供应商 Key 轮换、按优先级路由及响应开始前的故障切换
- 管理员一键停止或恢复模型 API，停服状态跨进程重启持久化
- 测试模式与比赛模式用于考务状态和大屏展示，模型 API 在两种模式下采用相同转发规则
- 最近 100 条请求元数据和进程级运行指标
- 管理员使用独立登录入口和独立会话 Cookie；评委和选手共用统一登录页，由账号本身决定进哪一端
- 评委富文本发布/关闭题目，选手通过 SSE 实时接题、富文本答题、手动保存草稿与最终提交
- 选手端答案实时写入浏览器 localStorage；刷新或异常退出后若本机内容与服务端草稿不同，会用横幅询问恢复还是丢弃
- 评委端和选手端的 SSE 通道在服务重启、反代报错后自动退避重连，不需要手动刷新页面
- 评委实时查看全部选手的未开始、草稿、已提交状态及完整时间记录
- 单密码保护的比赛大屏实时显示比赛状态、倒计时和全部选手答题进度
- 评委端可一键导出全部已发布/已关闭题目的答卷 ZIP；ZIP 按选手分目录，每道题同时生成 Word 和 PDF，未作答也会保留明确标注
- MySQL 持久化考核数据，题目和答卷的图片及任意附件流式保存在服务器本地数据目录
- 选手登录后可查看专属 API URL、API Key、允许模型和调用示例
- 选手 API 文档页内置 Playground，支持文本与 Qwen 图片理解测试；调用与外部客户端走同一个网关端点，不附加本地额度或频率限制
- 公网实例走 `deploy.sh` 本地构建推送 + systemd + nginx，赛中实例走 macOS `launchd` 常驻

选手 API Key 随账号保存在 MySQL；运维客户端 Key、供应商 Key 和路由仍使用环境变量管理。最近请求元数据保存在进程内存。模型 API 的停服状态和运行模式分别保存在 `MODELMUX_DATA_DIR/gateway-service-state.json` 与 `gateway-operation-mode.json`，考核账号、题目、答卷和时间记录持久化到 MySQL。

## 本地开发

依赖 Node.js 22+ 和 pnpm 10+：

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

选手入口为 `http://localhost:1444/contestant/questions`，API 文档为 `http://localhost:1444/contestant/api-docs`（Playground 是这个页面里的弹窗），比赛投屏为 `http://localhost:1444/screen`，管理员控制台为 `http://localhost:1444/admin`。模型 API 不支持匿名调用；没有有效选手账号或运维 Key 时，网关不会成为开放代理。

管理员总览通过 `MODELMUX_INTERNAL_BASE_URL` 和 `MODELMUX_EXTERNAL_BASE_URL` 显示内网、外网入站端口及完整 API 地址。没有公网入站服务时将外网地址留空，总览会明确显示“未开放”。

考核系统入口：

| 入口 | 地址 | 登录保护 |
| --- | --- | --- |
| 统一登录页 | `http://localhost:1444/login` | 评委和选手共用；按账号密码判定角色，登录后跳到对应工作台 |
| 选手答题端 | `http://localhost:1444/contestant/questions` | 管理员生成的选手账号，Cookie 为 `modelmux_competition_session` |
| 评委工作台 | `http://localhost:1444/judge/questions` | 管理员生成的评委账号，Cookie 为 `modelmux_competition_session` |
| 比赛投屏 | `http://localhost:1444/screen` | 使用与管理员相同的单密码；签发独立只读大屏 Cookie，不授予管理员权限 |
| 管理员控制台 | `http://localhost:1444/admin` | 独立管理密码，Cookie 为 `modelmux_admin_session` |

评委和选手共用一个会话 Cookie，因此同一个浏览器同一时刻只能是其中一个身份，后登录的会顶掉先登录的；要同时开两端请用两个浏览器或无痕窗口。管理员 Cookie、大屏只读 Cookie 与它们相互独立，可以同时保持登录；大屏虽然复用管理员密码，但大屏会话不能访问 `/admin` 或 `/api/admin/*`。同一个账号名同时存在于评委和选手时，登录页会让本人再选一次角色。后台页面和 `/api/admin/*` 均强制验证管理员会话；模型 API 另用客户端 API Key，不复用任何网页登录凭据。

评委在 Dashboard 填写比赛时长后开始比赛；开始状态下选手同时看到整套题目并可正常保存、提交，`/screen` 同步显示倒计时。评委可随时停止比赛，停止或自然到时后选手端隐藏全部题目，只显示“比赛已结束”；再次开始会重新计时并保留历史答案。首次开始前显示“比赛未开始”。比赛未运行时，评委可在 `/judge/answers` 删除题目，删除操作会同时永久删除该题已有答卷；比赛进行中禁止删除。默认时长由 `MODELMUX_COMPETITION_DURATION_MINUTES` 控制，必须为正整数，默认 90 分钟。

评委在 Dashboard 点击“导出全部答卷”即可下载归档 ZIP。导出会把选手回答中的图片嵌入 Word/PDF，普通附件仍以文件名、大小和站内下载地址写入文档，不会把任意大的普通附件复制进归档；附件仍保存在 `MODELMUX_DATA_DIR/uploads`，可从系统中下载。大屏每 3 秒刷新数据，选手超过单屏容量时自动调整布局。

完整验证：

```bash
pnpm check
```

## 接口调用

```bash
curl http://localhost:1444/v1/models \
  -H 'Authorization: Bearer <client-key>'

curl http://localhost:1444/v1/chat/completions \
  -H 'Authorization: Bearer <client-key>' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-v4-pro",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

模型 API 统一使用 OpenAI Chat Completions 兼容规范和 `Authorization: Bearer <client-key>` 鉴权。实际调用由下方白名单映射到对应国产模型平台，供应商密钥不会下发给选手。

模型 API 和选手 Playground 不设置 Base64 请求体大小上限，网关会完整解析并转发请求，由上游模型平台决定是否接受。Base64 会比原始二进制数据增大约三分之一，大请求在并发时会占用更多网关内存。

客户端只能使用以下白名单型号，`model` 必须与模型平台返回的真实模型 ID 完全一致：

| `model` ID | 模型平台 | 上下文 | 备注 |
| --- | --- | --- | --- |
| `deepseek-v4-flash` | DeepSeek 官方 | 1M | 硅基流动备用 |
| `deepseek-v4-pro` | DeepSeek 官方 | 1M | 硅基流动备用 |
| `qwen3.7-flash` | 阿里云百炼 | 1M | 硅基流动备用 |
| `qwen3.7-plus` | 阿里云百炼 | 1M | 硅基流动备用 |
| `qwen3.7-max` | 阿里云百炼 | 1M | 硅基流动备用 |
| `qwen3.8-max` | 阿里云百炼 | 1M | 最新千问旗舰 |
| `ZHIPU/GLM-5.3` | 阿里云百炼 · 智谱原厂直供 | 1M | 最新 GLM 旗舰 |
| `kimi/kimi-k3` | 阿里云百炼 · Moonshot 原厂直供 | 1M | 最新 Kimi 旗舰 |
| `MiniMax/MiniMax-M3` | 阿里云百炼 · MiniMax 原厂直供 | 192K | 最新 MiniMax 多模态推理模型 |
| `doubao-seed-2-0-pro-260215` | 火山方舟 | 以平台为准 | 配置 `ARK_API_KEYS` 后自动开放 |

网关不支持 `deepseek`、`qwen`、`deepseek-pro`、`qwen-pro` 等简称或旧产品名，大小写也必须与表中 ID 一致；不精确的名称统一返回 `400 model_not_allowed`。DeepSeek V4 的思考参数是 `thinking.type=enabled|disabled` 与可选的 `reasoning_effort=high|max`；Qwen Chat Completions 使用 `enable_thinking` 与可选的正整数 `thinking_budget`。网关只校验并转发官方参数，不根据模型名称擅自覆盖。

当前 Qwen、Kimi K3、MiniMax M3 和豆包旗舰路由支持文本、图像和视频理解，并返回文本内容；GLM-5.3 与 DeepSeek V4 仅开放文本输入。多模态理解不等同于文生图；浏览器 Playground 当前只开放单张 PNG/JPG/WebP 图片。外部客户端可按 OpenAI Chat Completions 的 `image_url` / `video_url` 调用。

GLM、Kimi、MiniMax 与 Qwen 旗舰只有在 `DASHSCOPE_API_KEYS` 已配置时才进入选手白名单；豆包只有在 `ARK_API_KEYS` 已配置时才进入白名单。这样 `/v1/models` 和选手 API 文档不会发布实际无法调用的模型。

## 两种部署

| 环境 | API 示例 | 运行方式 |
| --- | --- | --- |
| 赛前公网 | `https://debug.example.com/v1` | Next.js standalone + systemd + nginx（HTTPS），用 `./deploy.sh` 从本地构建推送 |
| 赛中本地 | `http://10.20.0.1:4000/v1` | Next.js standalone + `launchd` |

公网和本地实例分别保存环境变量、密钥和运行日志。开赛前在公网实例的“系统设置”中停止模型 API；管理员后台与 `/health` 保持在线，便于确认和恢复。赛中终端不设置默认网关和 DNS，只能访问 Mac mini 上的江苏省监测技能竞赛在线答题系统。

## 运行模式

“系统设置”里的运行模式与停服开关相互独立，两个实例各自保存自己的模式，公网实例切换不会影响局域网实例。

| 模式 | 大屏状态 | 模型 API | 典型用途 |
| --- | --- | --- | --- |
| 测试模式 | 测试演练中 | 鉴权、白名单路由后转发 | 赛前公网联调、设备演练 |
| 比赛模式 | 比赛进行中 | 鉴权、白名单路由后转发 | 正式比赛 |

默认是测试模式。模式保存在 `MODELMUX_DATA_DIR/gateway-operation-mode.json`，跨进程重启保留；文件损坏时大屏回到测试演练状态，并在管理员后台给出提示。

两种模式都不设置账号调用额度、RPM 或请求体大小上限。模式不干预请求参数和上游响应；模型白名单、供应商路由、API Key 鉴权与停服开关仍然生效。

评委端和选手端顶部显示模式横幅，登录页也会显示，模式变化通过既有的 SSE 通道实时推送，不需要刷新页面。`GET /api/competition/mode` 只返回模式本身，不需要登录。

部署步骤见 [docs/03-deployment.md](./docs/03-deployment.md)，架构边界见 [docs/02-application-architecture.md](./docs/02-application-architecture.md)。

## 目录

```text
app/                 Next.js 页面与 HTTP Route Handlers
src/                 管理控制台客户端组件与样式
lib/gateway/         网关配置、鉴权、路由、代理与测试
lib/competition/     考核数据、双角色鉴权、富文本清洗与实时事件
deploy/              公网 systemd/nginx 与 Mac mini launchd 配置示例
deploy.sh            公网实例的本地构建推送脚本
scripts/             常驻启动与数据库初始化脚本
docs/                组网、架构与部署文档
```
