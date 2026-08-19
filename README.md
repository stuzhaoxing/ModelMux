# 江苏省监测技能竞赛在线答题系统

江苏省监测技能竞赛在线答题系统是面向竞赛场景的自托管答题与大模型网关服务。赛前部署为互联网调试服务，赛中运行在 Mac mini 的隔离局域网；两种环境使用同一套 Next.js 服务、OpenAI 与 Claude 兼容接口和模型白名单，选手只切换 API URL。

## 当前能力

- Next.js 16 管理控制台与 Node.js 网关运行时，首页为选手答题入口
- `GET /health`，覆盖网关配置、停服开关和考核数据库连通性；MySQL 连不上时返回 `503` 且 `status` 为 `degraded`
- `GET /v1/models`
- `POST /v1/chat/completions`，支持普通响应与 SSE 流式透传
- `POST /v1/messages`，兼容 Claude Messages API、工具调用与 Claude SSE 流式事件
- 每位选手独立 API Key、持久化请求额度、模型白名单、请求体限制和单进程 RPM 限流
- 供应商 Key 轮换、按优先级路由及响应开始前的故障切换
- 管理员一键停止或恢复模型 API，停服状态跨进程重启持久化
- 测试模式与比赛模式双运行模式，比赛模式解除选手总请求额度，评委端和选手端顶部同步显示当前模式
- 最近 100 条请求元数据和进程级运行指标
- 管理员使用独立登录入口和独立会话 Cookie；评委和选手共用统一登录页，由账号本身决定进哪一端
- 评委富文本发布/关闭题目，选手通过 SSE 实时接题、富文本答题、手动保存草稿与最终提交
- 选手端答案实时写入浏览器 localStorage；刷新或异常退出后若本机内容与服务端草稿不同，会用横幅询问恢复还是丢弃
- 评委端和选手端的 SSE 通道在服务重启、反代报错后自动退避重连，不需要手动刷新页面
- 评委实时查看全部选手的未开始、草稿、已提交状态及完整时间记录
- MySQL 持久化考核数据，图片保存在服务器本地数据目录
- 选手登录后可查看专属 API URL、API Key、已用/剩余额度、允许模型和调用示例
- 选手 API 文档页内置 Playground，支持文本与 Qwen 图片理解测试；调用走同一个网关端点，因此与外部客户端一样受 RPM 限流并在测试模式下扣减总请求额度
- 公网实例走 `deploy.sh` 本地构建推送 + systemd + nginx，赛中实例走 macOS `launchd` 常驻

选手 API Key 和总请求额度随账号保存在 MySQL；运维客户端 Key、供应商 Key 和路由仍使用环境变量管理。网关调用日志与分钟限流状态保存在进程内存。模型 API 的停服状态和运行模式分别保存在 `MODELMUX_DATA_DIR/gateway-service-state.json` 与 `gateway-operation-mode.json`，考核账号、题目、答卷和时间记录持久化到 MySQL。

## 本地开发

依赖 Node.js 22+ 和 pnpm 10+：

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

选手入口为 `http://localhost:1444/contestant/questions`，API 文档为 `http://localhost:1444/contestant/api-docs`（Playground 是这个页面里的弹窗），管理员控制台为 `http://localhost:1444/admin`。默认关闭匿名调用；没有有效选手账号或运维 Key 时，网关不会成为开放代理。

管理员总览通过 `MODELMUX_INTERNAL_BASE_URL` 和 `MODELMUX_EXTERNAL_BASE_URL` 显示内网、外网入站端口及完整 API 地址。没有公网入站服务时将外网地址留空，总览会明确显示“未开放”。

考核系统入口：

| 入口 | 地址 | 登录保护 |
| --- | --- | --- |
| 统一登录页 | `http://localhost:1444/login` | 评委和选手共用；按账号密码判定角色，登录后跳到对应工作台 |
| 选手答题端 | `http://localhost:1444/contestant/questions` | 管理员生成的选手账号，Cookie 为 `modelmux_competition_session` |
| 评委工作台 | `http://localhost:1444/judge/questions` | 管理员生成的评委账号，Cookie 为 `modelmux_competition_session` |
| 管理员控制台 | `http://localhost:1444/admin` | 独立管理密码，Cookie 为 `modelmux_admin_session` |

评委和选手共用一个会话 Cookie，因此同一个浏览器同一时刻只能是其中一个身份，后登录的会顶掉先登录的；要同时开两端请用两个浏览器或无痕窗口。管理员 Cookie 与它们相互独立，可以和任意一端同时保持登录。同一个账号名同时存在于评委和选手时，登录页会让本人再选一次角色。后台页面和 `/api/admin/*` 均强制验证管理员会话；模型 API 另用客户端 API Key，不复用任何网页登录凭据。

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
    "model": "deepseek-pro",
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'

curl http://localhost:1444/v1/messages \
  -H 'x-api-key: <client-key>' \
  -H 'anthropic-version: 2023-06-01' \
  -H 'Content-Type: application/json' \
  -d '{
    "model": "deepseek-pro",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "你好"}],
    "stream": false
  }'
```

两套规范共用同一把选手 Key、RPM 限制、总请求额度和全部公开模型别名。Claude 兼容入口接受 `x-api-key` 和 `anthropic-version`，并在 `stream: true` 时返回 Claude SSE 事件。协议兼容不代表提供 Claude 模型；实际调用仍由下方白名单映射到 Qwen 或 DeepSeek 上游，供应商密钥不会下发给选手。

客户端只能使用以下稳定白名单型号，真实上游模型 ID 只由服务端路由决定：

| 对外型号 | 默认主路由 | 默认备用路由 |
| --- | --- | --- |
| `deepseek-flash` | DeepSeek 官方 / `deepseek-v4-flash` | 硅基流动 |
| `deepseek-pro` | DeepSeek 官方 / `deepseek-v4-pro` | 硅基流动 |
| `qwen-flash` | 阿里云百炼 / `qwen3.7-flash` | 硅基流动 |
| `qwen-pro` | 阿里云百炼 / `qwen3.7-plus` | 硅基流动 |
| `qwen-max` | 阿里云百炼 / `qwen3.7-max` | 硅基流动 |

旧别名 `deepseek` 和 `qwen` 分别兼容到两个 Pro 档。DeepSeek 官方仅提供 Flash、Pro，因此不提供 `deepseek-max`。DeepSeek V4 的思考参数是 `thinking.type=enabled|disabled` 与可选的 `reasoning_effort=high|max`；Qwen Chat Completions 使用 `enable_thinking` 与可选的正整数 `thinking_budget`。网关只校验并转发官方参数，不根据模型档位擅自覆盖。供应商 Key、Base URL、默认模型和硅基流动备用模型均在 `.env.example` 中配置。

当前 Qwen Flash、Pro、Max 路由支持文本、图像和视频理解，并返回文本内容。多模态理解不等同于文生图；浏览器 Playground 当前只开放单张 PNG/JPG/WebP 图片。外部客户端可按 OpenAI Chat Completions 的 `image_url` / `video_url` 调用，或在 Claude Messages 中使用 `image` / `source` 内容块传入图片；Claude 兼容入口暂不接受视频内容块。

## 两种部署

| 环境 | API 示例 | 运行方式 |
| --- | --- | --- |
| 赛前公网 | `https://debug.example.com/v1` | Next.js standalone + systemd + nginx（HTTPS），用 `./deploy.sh` 从本地构建推送 |
| 赛中本地 | `http://10.20.0.1:4000/v1` | Next.js standalone + `launchd` |

公网和本地实例分别保存环境变量、密钥和运行日志。开赛前在公网实例的“系统设置”中停止模型 API；管理员后台与 `/health` 保持在线，便于确认和恢复。赛中终端不设置默认网关和 DNS，只能访问 Mac mini 上的江苏省监测技能竞赛在线答题系统。

## 运行模式

“系统设置”里的运行模式与停服开关相互独立，两个实例各自保存自己的模式，公网实例切换不会影响局域网实例。

| 模式 | 选手总请求额度 | 每分钟频率 | 典型用途 |
| --- | --- | --- | --- |
| 测试模式 | 生效，用完返回 `429 quota_exceeded` | 生效 | 赛前公网联调、设备演练 |
| 比赛模式 | 不拦截，只继续累计调用次数 | 生效 | 正式比赛 |

默认是测试模式。模式保存在 `MODELMUX_DATA_DIR/gateway-operation-mode.json`，跨进程重启保留；文件损坏时按测试模式限量运行，并在管理员后台给出提示。

比赛模式只解除总额度，不解除 RPM 限流、模型白名单、请求体大小限制和停服开关。网关在每个响应上返回 `X-ModelMux-Mode: test|competition`；比赛模式下不再返回 `X-Quota-Remaining`。

评委端和选手端顶部显示模式横幅，登录页也会显示，模式变化通过既有的 SSE 通道实时推送，不需要刷新页面。`GET /api/competition/mode` 只返回模式本身，不需要登录。

切换模式时可以勾选“同时清零所有选手的已用调用次数”。从比赛模式切回测试模式时务必留意：比赛期间累计的调用次数会立刻与总额度比较，超出的账号会直接被拦截。

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
