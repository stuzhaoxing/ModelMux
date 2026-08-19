# 江苏省监测技能竞赛在线答题系统 Web 服务与 Gateway 架构

状态：Next.js 重构版  
日期：2026-08-13

## 1. 交付形态

江苏省监测技能竞赛在线答题系统是一个自托管 Next.js 服务，而不是桌面应用。管理人员通过浏览器访问控制台，选手通过 OpenAI 兼容或 Claude Messages 兼容 HTTP API 调用模型。

```text
江苏省监测技能竞赛在线答题系统 Next.js standalone
├── 选手答题首页（选手会话）
├── 评委工作台（评委会话）
├── 管理控制台与管理 API（管理员会话）
└── Gateway Route Handlers（客户端 API Key）
    ├── 选手 Bearer / x-api-key 鉴权
    ├── 模型白名单与别名映射
    ├── RPM 与请求体限制
    ├── Provider 路由、Key 轮换与故障切换
    ├── OpenAI 兼容普通响应与 SSE 透传
    ├── Claude Messages 请求与响应转换
    └── Claude SSE 事件转换
```

同一构建部署为两个彼此独立的实例：

```text
赛前公网实例                         赛中本地实例
https://debug.example.com/v1        http://10.20.0.1:4000/v1
Docker + Caddy                      Mac mini + launchd
```

两边保持相同请求格式、模型别名和错误结构。选手程序在正式比赛时只更换服务地址。

## 2. HTTP 边界

| 路径 | 访问者 | 保护方式 |
| --- | --- | --- |
| `/` | 选手 | 选手账号与独立 HttpOnly 会话 |
| `/judge/questions`、`/judge/answers` | 评委 | 评委账号与独立 HttpOnly 会话 |
| `/admin` | 管理员 | 独立管理密码与签名 HttpOnly 会话 |
| `/api/admin/*` | 管理控制台 | 服务端再次验证管理员会话 |
| `/health` | 部署监控 | 不含密钥和路由详情 |
| `/v1/models` | 选手程序 | 选手 Bearer Key |
| `/v1/chat/completions` | 选手程序 | 选手 Bearer Key、白名单、限流 |
| `/v1/messages` | 选手程序 | 同一选手 Key（`x-api-key`）、`anthropic-version`、白名单、限流 |
| `/api/competition/contestant/playground` | 已登录选手 | Cookie、同源校验、白名单、独立 RPM 限流；不预留选手总额度 |

未配置完整的管理密码和会话签名密钥时，管理员登录返回 `503`，不会以匿名方式开放。选手接口未配置 Client Key 时返回 `503 client_auth_not_configured`；提供错误 Key 时返回 `401 invalid_api_key`。

管理员可在“系统设置”停止模型 API。停止后，OpenAI 与 Claude 兼容模型端点的新请求统一返回 `503 service_suspended`，管理控制台不受影响。`/health` 返回 HTTP 200、`status: "suspended"`、`ready: true` 和 `apiReady: false`，使部署平台继续监控进程，同时明确模型 API 并未开放。

## 3. 模型路由

客户端只看见 `deepseek-flash`、`deepseek-pro`、`qwen-flash`、`qwen-pro`、`qwen-max` 五个稳定产品型号。DeepSeek 官方没有 Max 模型。旧别名 `deepseek` 和 `qwen` 仅兼容到对应 Pro 档。每个产品型号对应按优先级排序的供应商候选路由：

Qwen 三档均按多模态输入模型开放，支持文本、图像和视频理解，输出为文本。浏览器 Playground 将本地图片编码成受大小限制的 Data URL；服务端仍通过同一模型白名单和供应商路由处理请求。

```text
deepseek-pro
├── 优先级 100：DeepSeek 官方 / deepseek-v4-pro
└── 优先级 70：硅基流动 / 已验证的 DeepSeek 备用模型

qwen-pro
├── 优先级 100：阿里云百炼 / qwen3.7-plus
└── 优先级 70：硅基流动 / 已验证的 Qwen 备用模型
```

当前执行规则：

1. 每条供应商路由可以引用一个环境变量 Key 池，调用时轮换 Key。
2. 网络错误、超时、`408`、`429` 或 `5xx` 可以尝试下一 Key 或下一路由。
3. 每次候选请求使用该路由自己的真实上游模型 ID。
4. 一旦选定上游响应并开始向客户端返回，禁止切换供应商，避免拼接两条 SSE 流。
5. `4xx` 业务错误不会自动故障切换，防止重复提交无效请求。
6. Flash、Pro、Max 是官方模型规格，不代表思考开关或推理强度；网关不根据规格名称覆盖参数。
7. Playground 使用独立的内部客户端身份记录和限流，`contestantId` 固定为空，因此不会调用选手额度预留与退款逻辑；普通 `/v1/chat/completions` 仍按选手 API Key 扣减额度。
8. DeepSeek V4 官方使用 `thinking.type=enabled|disabled` 与可选的 `reasoning_effort=high|max`；Qwen Chat Completions 使用 `enable_thinking` 与可选的正整数 `thinking_budget`。
9. 切换至硅基流动备用路由时，适配层只做供应商协议必需的等价转换，不改变显式思考开关；DeepSeek V4 未指定开关时遵循官方默认的思考模式。
10. Claude 兼容入口把 Messages API 的 `system`、内容块、图片和工具调用转换到同一内部调用链，并将普通响应或流式事件转换回 Claude 结构；它不暴露任何供应商 Key，也不绕过选手额度。

## 4. 安全默认值

1. 匿名选手调用默认关闭。
2. 上游 Key 和选手 Key只读取服务端环境变量，不进入页面数据。
3. 管理 API 只返回供应商是否已配置，不返回 Base URL、密钥环境变量名或密钥值。
4. 仅接受模型白名单内的公开型号或兼容别名，不接受真实上游模型 ID，防止绕过产品档位，并在服务端重写上游模型。
5. 默认请求体上限 2 MiB，默认每个凭证 60 RPM。
6. CORS 默认不开放；仅在明确配置来源后返回跨域响应头。
7. 公网部署使用 Caddy/Nginx 终止 TLS，限制请求体并关闭流式响应缓冲。
8. 管理员、评委和选手登录设有失败次数限制；只有受信任反向代理覆盖来源头时才能启用 `MODELMUX_TRUST_PROXY=true`。
9. 代理层只做快速入口拦截；页面渲染和每个管理 API 都会再次验证管理员签名会话。

## 5. 当前持久化边界

当前版本的运行指标、分钟限流桶和最近 100 条请求元数据只保存在单个 Node.js 进程内，进程重启即清空。供应商密钥和运维客户端密钥保存在部署环境变量中；选手独立 API Key、总请求额度和已用次数随账号保存在 MySQL。

模型 API 的运行开关是例外：状态原子写入 `MODELMUX_DATA_DIR/gateway-service-state.json`，进程或容器重启后仍保持。状态文件损坏或不可读取时采取失败即关闭策略，管理员可从设置页重新开启并修复文件。

这足以支持单机竞赛联调和约 20 名选手的首版交付，但不等同于完整运营平台。以下能力需要在下一阶段加入共享数据库或 Redis：

- Key 到期、轮换和摘要存储
- TPM 与并发额度
- 跨进程或多实例限流
- 持久化请求审计和费用统计
- 路由健康检查、熔断、半开放探测

## 6. 赛中隔离边界

Next.js 替换 Tauri 不改变赛场网络原则：Mac mini 的 Wi-Fi 访问上游互联网模型 API，有线网卡只连接独立交换机/AP；选手终端不配置默认网关和 DNS；Mac mini 不开启 IP 转发、NAT 或互联网共享。详细组网见 [01-network-topology.md](./01-network-topology.md)。
