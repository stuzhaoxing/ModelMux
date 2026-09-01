# 江苏省监测技能竞赛在线答题系统 Web 服务与 Gateway 架构

状态：Next.js 重构版  
日期：2026-08-13

## 1. 交付形态

江苏省监测技能竞赛在线答题系统是一个自托管 Next.js 服务，而不是桌面应用。管理人员通过浏览器访问控制台，选手通过 OpenAI 兼容 HTTP API 调用模型。

```text
江苏省监测技能竞赛在线答题系统 Next.js standalone
├── 选手答题首页（选手会话）
├── 评委工作台（评委会话）
├── 管理控制台与管理 API（管理员会话）
└── Gateway Route Handlers（客户端 API Key）
    ├── 选手 Bearer 鉴权
    ├── 模型白名单与平台模型 ID 精确校验
    ├── 请求参数与响应内容透传
    ├── Provider 路由、Key 轮换与故障切换
    └── OpenAI 兼容普通响应与 SSE 透传
```

同一构建部署为两个彼此独立的实例：

```text
赛前公网实例                         赛中本地实例
https://debug.example.com/v1        http://10.20.0.1:4000/v1
Linux + systemd + nginx             Mac mini + launchd
```

两边保持相同请求格式、平台模型 ID 和错误结构。选手程序在正式比赛时只更换服务地址。

## 2. HTTP 边界

| 路径 | 访问者 | 保护方式 |
| --- | --- | --- |
| `/login` | 评委、选手 | 统一登录页，按账号密码判定角色 |
| `/` | 选手 | 选手账号与 `modelmux_competition_session` |
| `/judge/questions`、`/judge/answers` | 评委 | 评委账号与同一个 `modelmux_competition_session` |
| `/admin` | 管理员 | 独立管理密码与签名 HttpOnly 会话 |
| `/api/admin/*` | 管理控制台 | 服务端再次验证管理员会话 |
| `/health` | 部署监控 | 不含密钥和路由详情，数据库故障只回分类码 |
| `/v1/models` | 选手程序 | 选手 Bearer Key |
| `/v1/chat/completions` | 选手程序 | 选手 Bearer Key、模型白名单与供应商路由 |

评委和选手共用一个会话 Cookie：同一台电脑同一时刻只能是其中一个身份，服务端也据此把访问另一端路径的人送回自己的工作台。管理员会话独立，可与任一端并存。

未配置完整的管理密码和会话签名密钥时，管理员登录返回 `503`，不会以匿名方式开放。选手接口未配置 Client Key 时返回 `503 client_auth_not_configured`；提供错误 Key 时返回 `401 invalid_api_key`。

管理员可在“系统设置”停止模型 API。停止后，OpenAI 兼容模型端点的新请求统一返回 `503 service_suspended`，管理控制台不受影响。`/health` 返回 HTTP 200、`status: "suspended"`、`ready: true` 和 `apiReady: false`，使部署平台继续监控进程，同时明确模型 API 并未开放。

`/health` 还会探测考核数据库：配置了 `MODELMUX_DATABASE_URL` 却连不上时返回 HTTP 503、`status: "degraded"`、`ready: false`，并在 `database` 字段给出 `unreachable`、`auth_failed`、`missing_database`、`timeout` 之一。停服开关只关模型 API，答题、评委工作台和登录仍然全靠 MySQL，所以数据库故障的优先级高于停服状态。探测只做一次 `SELECT 1` 并带 2 秒超时，不触发建表；没有配置数据库的纯网关实例只报 `configured: false`，不影响就绪判定。

## 3. 模型路由

客户端只看见当前已配置供应商实际可调用的真实模型 ID。基础目录包含 DeepSeek V4 与 Qwen 3.7；配置百炼 Key 后增加 `qwen3.8-max`、`ZHIPU/GLM-5.3`、`kimi/kimi-k3`、`MiniMax/MiniMax-M3`；配置火山方舟 Key 后增加 `doubao-seed-2-0-pro-260215`。网关不接受简称、旧产品名或大小写不一致的名称。每个模型 ID 对应按优先级排序的供应商候选路由：

Qwen 三档均按多模态输入模型开放，支持文本、图像和视频理解，输出为文本。浏览器 Playground 将本地图片编码成 Data URL；服务端不设置请求体大小上限，仍通过同一模型白名单和供应商路由处理请求。

```text
deepseek-v4-pro
├── 优先级 100：DeepSeek 官方 / deepseek-v4-pro
└── 优先级 70：硅基流动 / 已验证的 DeepSeek 备用模型

qwen3.7-plus
├── 优先级 100：阿里云百炼 / qwen3.7-plus
└── 优先级 70：硅基流动 / 已验证的 Qwen 备用模型

kimi/kimi-k3
└── 优先级 100：阿里云百炼 Moonshot 原厂直供 / kimi/kimi-k3

doubao-seed-2-0-pro-260215（仅配置 ARK_API_KEYS 后开放）
└── 优先级 100：火山方舟 / doubao-seed-2-0-pro-260215
```

当前执行规则：

1. 每条供应商路由可以引用一个环境变量 Key 池，调用时轮换 Key。
2. 网络错误、超时、`408`、`429` 或 `5xx` 可以尝试下一 Key 或下一路由。
3. 每次候选请求使用该路由自己的真实上游模型 ID。
4. 一旦选定上游响应并开始向客户端返回，禁止切换供应商，避免拼接两条 SSE 流。
5. `4xx` 业务错误不会自动故障切换，防止重复提交无效请求。
6. 模型 ID 采用平台原名，不代表思考开关或推理强度；网关不根据模型名称覆盖参数。
7. Playground 没有专用后端，浏览器直接拿选手自己的 API Key 调 `/v1/chat/completions`，因此和外部客户端走完全相同的鉴权、白名单与供应商路由；网关不记录个人调用量，也不设置本地额度或频率限制，只汇总本场比赛的分钟级 Token 总量供大屏展示。
8. DeepSeek V4 官方使用 `thinking.type=enabled|disabled` 与可选的 `reasoning_effort=high|max`；Qwen Chat Completions 使用 `enable_thinking` 与可选的正整数 `thinking_budget`。
9. 切换备用路由时，只把 `model` 替换为该路由的上游模型 ID；流式请求额外合并 `stream_options.include_usage=true` 以读取上游用量，其余请求参数不校验、不删除，由上游决定是否接受。

## 4. 安全默认值

1. 模型 API 不支持匿名调用，每个请求都必须携带有效的选手 Bearer Key。
2. 上游 Key 和选手 Key只读取服务端环境变量，不进入页面数据。
3. 管理 API 只返回供应商是否已配置，不返回 Base URL、密钥环境变量名或密钥值。
4. 仅接受白名单内与主平台完全一致的模型 ID；简称、旧名称、大小写变体和首尾空格全部拒绝。
5. 模型 API 不设置应用层请求体大小、账号调用额度或 RPM 上限；上游平台仍可能按自身规则拒绝请求。
6. CORS 默认不开放；仅在明确配置来源后返回跨域响应头。
7. 公网部署由 nginx 终止 TLS，不限制请求体并关闭流式响应缓冲。
8. 管理员、评委和选手登录设有失败次数限制；只有受信任反向代理覆盖来源头时才能启用 `MODELMUX_TRUST_PROXY=true`。
9. 代理层只做快速入口拦截；页面渲染和每个管理 API 都会再次验证管理员签名会话。

## 5. 当前持久化边界

当前版本的运行指标和最近 100 条请求元数据只保存在单个 Node.js 进程内，进程重启即清空。供应商密钥和运维客户端密钥保存在部署环境变量中；选手独立 API Key、本场比赛分钟级 Token 汇总和管理员维护的赛前大屏公告随考核数据保存在 MySQL，不保存个人 Token 用量。大屏公告是单例纯文本配置，只允许管理员写入，并且仅在比赛状态为 `not_started` 时覆盖展示。

模型 API 的运行开关是例外：状态原子写入 `MODELMUX_DATA_DIR/gateway-service-state.json`，进程或容器重启后仍保持。状态文件损坏或不可读取时采取失败即关闭策略，管理员可从设置页重新开启并修复文件。

这足以支持单机竞赛联调和约 20 名选手的首版交付，但不等同于完整运营平台。以下能力需要在下一阶段加入共享数据库或 Redis：

- Key 到期、轮换和摘要存储
- 持久化请求审计和费用统计
- 路由健康检查、熔断、半开放探测

## 6. 赛中隔离边界

Next.js 替换 Tauri 不改变赛场网络原则：Mac mini 的 Wi-Fi 访问上游互联网模型 API，有线网卡只连接独立交换机/AP；选手终端不配置默认网关和 DNS；Mac mini 不开启 IP 转发、NAT 或互联网共享。详细组网见 [01-network-topology.md](./01-network-topology.md)。
