#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(toolDir, "..", "..");
const contestantDir = path.join(repoDir, "video", "contestant");
const sourceDir = path.join(contestantDir, "source");
const shotsDir = path.join(contestantDir, "shots");
const previewsDir = path.join(contestantDir, "previews");
const workRoot = path.join(contestantDir, "work");
const width = 1920;
const height = 1080;
const fps = 30;
const regularFont = "/System/Library/Fonts/STHeiti Light.ttc";
const boldFont = "/System/Library/Fonts/STHeiti Medium.ttc";
const closingText = "比赛中使用指定网络，核验材料和依据，及时保存并按要求提交。发生异常立即报告，具体安排以最新通知为准。";

const shots = {
  "02": { slug: "赛前设备与离线环境准备", scenes: [
    ["03-equipment", "赛前准备比赛电脑、电源、有线鼠标键盘和必要的有线网卡或转接器。建议内存不低于十六 GB、可用磁盘空间不低于一百 GB。"],
    ["04-check", "赛前还需在比赛用机准备本地知识库和所需规范资料。要确保除了大模型接口外，其他内容均能够在离线环境下完成启动、运行等操作。比赛现场不提供互联网访问能力。"],
  ] },
  "03": { slug: "登录并获取模型接入信息", scenes: [
    ["06-login", "按照通知进入赛前测试环境，使用组委会发放的测试账号登录，并核对姓名、账号和测试模式。测试数据不计入正式成绩。"],
    ["08-credentials", "登录后进入 API 技术文档，复制完整 API URL 和本人 API Key。"],
    ["08-models", "从可用模型列表直接复制模型 ID，并严格区分大小写。"],
  ] },
  "04": { slug: "配置本地知识库模型服务", scenes: [
    ["09-fields", "以 Cherry Studio 为例：在自定义服务商中填写 API Key、完整 API 地址，并获取或添加允许模型。"],
    ["08-security", "API Key 仅限本人测试使用，不得共享、公开。正式比赛时，按照比赛现场提供的局域网 API URL 进行替换即可，登录账号密码、API Key、模型 ID 等均与测试环境一致。"],
  ] },
  "05": { slug: "验证本地知识库正常运行", scenes: [
    ["10-pipeline", "随后在本地知识库中发起一次测试检索，确认资料能够正常召回，并能调用已配置模型生成结果。"],
    ["10-errors", "如果运行失败，先按状态码检查：四百零一核对凭证，四百核对模型，四百二十九降低频率，五百零三停止调用并报告。"],
  ] },
  "06": { slug: "测试答题环境操作", scenes: [
    ["07-nav", "模型和知识库验证完成后，返回答题工作台。该入口用于接题、作答、保存和提交。"],
    ["11-flow", "测试模式中完整演练题目读取、答题、附件上传、草稿保存、恢复和提交。"],
    ["11-save", "保存后等待页面显示已保存，再切换题目。"],
    ["11-lock", "最终提交后答案锁定。赛前应确认自己理解这一规则。"],
  ] },
  "07": { slug: "正式比赛登录与纪律", scenes: [
    ["12-network", "正式比赛只连接组委会指定网络。禁止热点、VPN、代理、外网模型和未经许可的服务。"],
    ["12-login", "使用正式账号登录，核对本人信息和比赛模式。正式模式下操作计入比赛记录。"],
    ["12-discipline", "账号、API Key、知识库和答案不得共享；不得代答、查看他人内容或干扰竞赛系统。客户端会按要求记录操作过程。"],
    ["13-wait", "比赛未开始时保持页面开启。开始后题目自动显示。考核时长九十分钟，请为核验和提交预留时间。"],
  ] },
  "08": { slug: "阅读题目与确定作答范围", scenes: [
    ["14-question", "收到题目后，先完整阅读题干、材料范围、作答要求和附件。"],
    ["14-boundary", "明确核查对象、可用材料、回答内容和提交形式，再开始检索。"],
  ] },
  "09": { slug: "检索分析与人工核验", scenes: [
    ["15-retrieval", "先在知识库检索相关规定和具体条款，再使用允许模型辅助梳理线索。"],
    ["15-classify", "模型输出后，回到原始材料和规范原文逐项核验，并区分已证实、疑似和证据不足。"],
    ["15-structure", "答案写明问题、证据位置、规范条款、分析过程和结论。"],
  ] },
  "10": { slug: "编辑答案与保存恢复", scenes: [
    ["16-editor", "在我的回答中组织文字、图片和题目允许的附件，并按照题目要求清晰呈现证据链。"],
    ["16-upload", "上传完成后，核对文件名称和可打开状态。"],
    ["16-save", "作答过程中多次保存草稿。等待页面显示已保存后再切换；修改后需要再次保存。"],
    ["17-detect", "出现本机未保存答案提示时，先核对缓存时间和内容。需要该版本时点击恢复，并再次保存；确认缓存无效时，才选择丢弃。"],
  ] },
  "11": { slug: "最终检查与逐题提交", scenes: [
    ["18-check", "最终提交前，逐题检查答案、事实数据、引用条款、附件和作答要求。"],
    ["18-confirm", "确认无误后点击最终提交，阅读提示后确认，并等待服务器返回结果。"],
    ["18-lock", "页面显示已提交并锁定后，该题不能修改或撤回。继续检查和提交其他题目。"],
  ] },
  "12": { slug: "异常报告与关键要求回顾", scenes: [
    ["19-errors", "无法登录、题目未显示、模型持续失败或保存上传失败时，立即停止重复操作并举手报告。"],
    ["19-ambiguous", "保存或提交结果不明确时，保持当前页面，不连续点击、不切换、不退出、不清除数据。"],
    ["19-report", "向现场人员说明发生时间、当前题目、执行操作和页面提示。未经同意不得调整网络、账号或设备。"],
    ["20-end", closingText],
  ] },
};

const info = (title, subtitle, items, footer = "", layout = "grid") => ({
  type: "info", title, subtitle, items, footer, layout,
});

const frameSpecs = {
  "02-prepare": info("赛前搭建，赛中使用", "先把能力准备好，再进入正式比赛", [
    ["赛前准备", "自备电脑与离线知识库"],
    ["接口测试", "登录、模型、检索与提交"],
    ["现场作答", "接题、分析、核验与保存"],
    ["逐题提交", "每道题分别确认并锁定"],
  ], "最终提交按题执行，不存在统一交卷按钮", "flow"),
  "02-test": info("赛前必须完成完整演练", "不能只验证模型能否返回文本", [
    ["登录系统", "核对账号与测试模式"],
    ["模型调用", "确认地址、凭证和模型"],
    ["知识库检索", "能够返回原文与来源"],
    ["答题操作", "草稿、附件、恢复、提交"],
  ]),
  "02-competition": info("正式比赛只替换现场信息", "请求格式和操作方法保持不变", [
    ["指定网络", "按现场安排接入"],
    ["正式账号", "核对姓名和比赛模式"],
    ["API URL", "使用现场页面完整地址"],
    ["API Key 与模型", "直接复制准确内容"],
  ]),
  "02-submit": info("题目自动出现，答案逐题提交", "从接题到锁定形成完整闭环", [
    ["接收题目", "评委开始后自动显示"],
    ["分析作答", "知识库检索并人工复核"],
    ["保存草稿", "确认已保存再切换"],
    ["最终提交", "当前题立即锁定"],
  ], "完成一题、检查一题、提交一题", "flow"),

  "03-equipment": info("赛前检查比赛电脑和配件", "所有必要设备由选手提前准备", [
    ["比赛电脑", "确认电池、接口和系统正常"],
    ["电源", "保证全程稳定供电"],
    ["有线鼠标键盘", "减少现场无线信号干扰"],
    ["有线网卡或转接器", "无 RJ45 接口时提前准备"],
  ]),
  "03-spec": info("配置建议不是评分条件", "目标是让知识库和开发工具稳定运行", [
    ["内存", "建议不低于 16GB"],
    ["磁盘", "建议可用空间不低于 100GB"],
    ["操作系统", "Windows 10 及以上或主流 Linux"],
    ["评分关系", "经验建议，不作为评分条件"],
  ]),
  "03-network": info("有线网络接口必须提前验证", "接口形式以组委会最新通知为准", [
    ["USB 转接器", "提前安装并验证驱动"],
    ["Type-C 转接器", "确认兼容性和稳定性"],
    ["有线鼠标", "避免无线设备相互干扰"],
    ["有线键盘", "减少现场连接不确定性"],
  ], "不要把第一次连接测试留到比赛现场"),

  "04-local": info("比赛所需资源全部保存在本机", "正式比赛网络与外网物理隔离", [
    ["参赛软件", "提前安装并完成配置"],
    ["本地知识库", "提前导入并完成索引"],
    ["文档工具", "确认规范资料可以打开"],
    ["规范资料", "离线可打开、可检索"],
  ]),
  "04-check": info("断开外网后完成一次全流程检查", "只启动成功还不够", [
    ["启动", "浏览器、知识库和开发工具"],
    ["索引", "本地资料可以正常入库"],
    ["检索", "能够返回相关原文"],
    ["引用", "文件名与条款可以定位"],
  ], "断开外网仍可完成以上四步，才算准备完成", "flow"),
  "04-warning": info("不要把在线步骤留到比赛现场", "以下步骤必须在赛前消除", [
    ["在线安装", "现场无法下载或安装软件"],
    ["在线登录", "避免临时账号验证"],
    ["在线授权", "避免许可证校验阻断"],
    ["临时下载", "避免索引或引用时联网"],
  ], "发现任何必须联网的步骤，都应在赛前改为离线可用", "warning"),

  "05-categories": info("知识库覆盖核查所需资料", "按业务用途组织，而不是简单堆放文件", [
    ["管理规定", "监督管理与责任要求"],
    ["行业技术指南", "不同排污单位适用要求"],
    ["手工监测规范", "采样、分析和质控"],
    ["自动监测规范", "设备、数据和运行要求"],
    ["监督检查规程", "检查方法和判定边界"],
  ], "资料版本应明确，失效文件应单独标识"),
  "05-search": { type: "knowledge", variant: "search" },
  "05-config": info("知识库必须能够快速更换三项配置", "赛前测试和正式比赛只替换现场值", [
    ["API URL", "完整复制现场服务地址"],
    ["API Key", "填写本人专属凭证"],
    ["模型 ID", "准确复制并区分大小写"],
  ], "不得写死公网地址或单一模型名称", "flow"),
  "05-human": info("模型辅助分析，选手负责结论", "结论必须回到材料和规范原文", [
    ["模型输出", "用于发现问题和整理线索"],
    ["原始材料", "核对事实、数据和位置"],
    ["规范原文", "核对有效版本和具体条款"],
    ["人工结论", "区分确认、疑似和证据不足"],
  ], "不得伪造引用，不得提交无关的预制结论", "flow"),

  "06-login": { type: "screen", source: "login", labels: ["测试账号由组委会统一发放", "测试地址以最新通知为准"] },
  "06-identity": { type: "screen", source: "legacyAnswer", labels: ["测试模式：数据不计入正式成绩", "核对本人姓名和账号", "确认页面连接状态"] },
  "06-realtime": info("实时连接与模型可用是两件事", "不要从一个状态推断另一个状态", [
    ["实时连接", "证明浏览器与答题系统连接正常"],
    ["模型 API", "必须通过实际调用单独验证"],
  ], "看到实时连接后，仍要完成模型最小调用", "compare"),

  "07-nav": { type: "screen", source: "answer", labels: ["答题工作台：接题、作答、保存、提交", "API 技术文档：地址、凭证、模型、示例"] },
  "07-credentials": info("网页登录凭证与模型凭证不能混用", "二者用途、输入位置和验证方式不同", [
    ["登录账号与密码", "只用于进入在线答题系统"],
    ["API Key", "只用于调用竞赛模型服务"],
  ], "不要把登录密码填入 API Key 字段", "compare"),

  "08-credentials": { type: "api", variant: "credentials" },
  "08-bearer": { type: "api", variant: "bearer" },
  "08-models": { type: "api", variant: "models" },
  "08-security": info("API Key 仅限本人、本场比赛使用", "凭证泄露会影响身份识别和比赛公平", [
    ["不得共享", "不转发给其他选手"],
    ["不得公开", "不写入公开代码仓库"],
    ["不得上传", "不作为答案附件提交"],
    ["不得暴露", "不出现在截图、日志或录屏"],
  ], "录制和截图前必须检查凭证是否被完整遮挡", "warning"),

  "09-fields": { type: "config", variant: "fields" },
  "09-replace": info("测试与比赛使用同一种请求格式", "正式比赛只替换现场页面提供的值", [
    ["替换地址", "API URL"],
    ["替换凭证", "API Key"],
    ["选择模型", "允许模型 ID"],
  ], "工具字段名称可以不同，三个值的含义不能变", "flow"),
  "09-errors": { type: "config", variant: "errors" },

  "10-endpoints": { type: "api", variant: "endpoints" },
  "10-pipeline": info("最小调用通过后，再验证知识库全链路", "收到模型回复不等于知识库准备完成", [
    ["查询模型", "确认允许模型列表"],
    ["短文本调用", "确认地址、凭证和模型"],
    ["知识库检索", "返回相关原文"],
    ["引用核验", "定位文件与具体条款"],
    ["长文本测试", "验证材料处理稳定性"],
  ], "五个环节都通过，才算完成联调", "flow"),
  "10-errors": { type: "api", variant: "errors" },
  "10-limit": info("比赛模式不等于没有调用限制", "总调用次数与每分钟频率是两个概念", [
    ["总调用次数", "比赛模式可能不拦截"],
    ["每分钟频率", "比赛模式仍然生效"],
    ["模型白名单", "仍只能使用允许模型"],
    ["服务暂停", "持续异常时立即报告"],
  ], "不要通过高频重复请求解决持续错误", "warning"),

  "11-flow": info("赛前完整演练一次答题流程", "每一步都要看到明确结果", [
    ["读取题目", "确认题干与附件"],
    ["输入答案", "使用富文本组织内容"],
    ["上传附件", "等待上传完成"],
    ["保存草稿", "看到已保存状态"],
    ["恢复内容", "恢复后再次保存"],
    ["最终提交", "确认锁定且不可撤回"],
  ]),
  "11-save": { type: "screen", source: "answer", labels: ["上传完成后检查文件", "点击保存草稿", "看到已保存再切换题目"] },
  "11-lock": { type: "screen", source: "locked", labels: ["测试题提交后同样锁定", "用测试环境熟悉不可撤回规则"] },

  "12-network": info("正式比赛只连接指定竞赛网络", "现场网络用于答题系统和允许的模型服务", [
    ["允许", "按赛务人员安排接入指定网络"],
    ["禁止", "手机热点、无线共享、VPN、代理"],
    ["禁止", "外网模型和未经许可的服务"],
    ["确认", "无线网络和代理已关闭"],
  ], "不自行修改竞赛网络设置", "warning"),
  "12-login": info("使用正式账号登录并核对状态", "正式比赛信息以现场页面为准", [
    ["系统地址", "使用现场公布的地址"],
    ["正式账号", "核对本人姓名和账号"],
    ["比赛模式", "所有操作计入正式记录"],
    ["连接状态", "确认答题系统连接正常"],
  ]),
  "12-discipline": info("账号、知识库和答案不得共享", "保持独立作答和竞赛公平", [
    ["不得代答", "不为他人操作或提交"],
    ["不得查看", "不查看其他选手电脑内容"],
    ["不得复制", "不拍摄、录制或复制答案"],
    ["不得干扰", "不扫描、攻击竞赛网络和系统"],
  ], "发现异常按现场流程报告，不自行探测", "warning"),
  "12-recording": info("所有操作应符合现场竞赛要求", "客户端会按照要求记录操作过程", [
    ["不得篡改", "不修改题干和答案记录"],
    ["不得联网", "不链接外网资源或模型"],
    ["不得替代", "不以历史截图代替现场结果"],
    ["物品管理", "手机和存储介质按现场要求执行"],
  ], "操作过程和提交结果均应真实、可核查", "warning"),

  "13-wait": { type: "waiting" },
  "13-time": info("九十分钟内完成完整核查与提交", "选手页面不显示虚构的统一倒计时控件", [
    ["材料核查", "先确认材料范围"],
    ["问题识别", "定位事实和线索"],
    ["依据核验", "回到规范原文"],
    ["答案组织", "写清证据、依据和结论"],
    ["逐题提交", "预留检查与确认时间"],
  ], "按题目数量自行安排时间，避免全部集中到最后提交", "flow"),

  "14-question": { type: "screen", source: "answer", labels: ["先在左侧选择题目", "完整阅读题干和作答要求", "确认题目附件是否可打开"] },
  "14-boundary": info("开始检索前先回答四个问题", "核查边界明确后再制定分析步骤", [
    ["核查对象", "本题要求判断什么"],
    ["材料范围", "哪些材料可以作为证据"],
    ["回答要求", "需要列出哪些问题与依据"],
    ["提交形式", "文字、图片或附件要求"],
  ]),
  "14-attachment": info("题目附件先打开、再记录重点", "不要等到提交前才检查文件", [
    ["确认可打开", "文件完整且格式正常"],
    ["记录页码", "标记需要引用的具体位置"],
    ["记录表格", "标记关键字段和数据"],
    ["记录材料关系", "明确证据对应的问题"],
  ], "演示画面只使用模拟题目和脱敏附件"),

  "15-retrieval": { type: "knowledge", variant: "verify" },
  "15-classify": info("答案应区分三种证据状态", "不要把所有线索都写成确定结论", [
    ["已证实问题", "事实与依据能够相互印证"],
    ["疑似线索", "存在异常但仍需补充核实"],
    ["证据不足", "现有材料无法支持确定判断"],
  ], "证据状态决定结论强度", "flow"),
  "15-structure": info("每项判断写清完整证据链", "让评审能够从结论回溯到材料和条款", [
    ["问题或线索", "具体指出发现"],
    ["证据位置", "文件、页码、表格或数据"],
    ["规范依据", "有效文件与具体条款"],
    ["分析判断", "说明证据如何支持结论"],
    ["结论与风险", "区分确认、疑似和不足"],
  ], "结论不是模型原文，而是经核验后的判断", "flow"),
  "15-responsibility": info("选手对最终答案负责", "模型输出必须经过人工核验", [
    ["不直接提交", "未经核验的模型输出"],
    ["不虚构", "文件、条款、数据或来源"],
    ["保证真实性", "事实与原始材料一致"],
    ["保证完整性", "依据、分析和结论完整"],
  ], "无法核实的内容应明确说明证据不足", "warning"),

  "16-editor": { type: "screen", source: "answer", labels: ["在我的回答区域组织内容", "按需要使用标题、列表和引用", "不做无意义排版"] },
  "16-upload": info("附件上传完成后再继续操作", "上传成功不等于内容已经核对", [
    ["等待完成", "不要在上传中切换题目"],
    ["核对名称", "确认选择的是正确文件"],
    ["检查打开", "确认文件能够查看或下载"],
    ["符合题目要求", "只上传允许的材料"],
  ]),
  "16-save": { type: "screen", source: "answer", labels: ["点击保存草稿", "等待正在保存变为已保存", "确认后再切换题目"] },
  "16-server": info("修改内容后需要再次保存", "服务器草稿与本机缓存作用不同", [
    ["服务器草稿", "点击保存草稿后写入服务器"],
    ["本机缓存", "异常恢复兜底，不能替代保存"],
  ], "看到已保存状态，才表示当前版本已写入服务器", "compare"),

  "17-detect": { type: "restore", variant: "prompt" },
  "17-restore": info("恢复后必须再次保存", "恢复只把本机内容放回编辑器", [
    ["核对时间", "确认缓存是需要的版本"],
    ["点击恢复", "内容回到编辑器"],
    ["检查内容", "确认没有覆盖正确草稿"],
    ["再次保存", "等待页面显示已保存"],
  ], "恢复不等于服务器保存", "flow"),
  "17-discard": { type: "restore", variant: "discard" },

  "18-check": info("最终提交前逐题检查", "提交成功后不能修改或撤回", [
    ["答案已保存", "页面显示已保存"],
    ["事实与数据", "与原始材料一致"],
    ["引用与条款", "来源完整、位置明确"],
    ["附件与要求", "文件可打开、无遗漏"],
  ]),
  "18-confirm": { type: "confirm" },
  "18-lock": { type: "screen", source: "locked", labels: ["当前题已正式交卷", "内容立即锁定", "刷新页面仍不能修改"] },
  "18-all": info("每道题分别检查并提交", "不存在一次提交全部答案的按钮", [
    ["打开当前题", "检查正文、引用和附件"],
    ["最终提交", "阅读提示后确认"],
    ["确认已提交", "左侧状态更新为已提交"],
    ["继续下一题", "直至所有题目完成"],
  ], "不得以误操作为由要求撤回已提交答案", "flow"),

  "19-errors": info("出现异常立即停止重复操作", "先保留现场，再由赛务人员核实", [
    ["无法登录", "保留登录页和错误提示"],
    ["模型持续失败", "停止高频重复调用"],
    ["题目未显示", "保持页面并报告"],
    ["附件或草稿失败", "不要继续切换题目"],
  ], "举手报告发生时间、当前题目和正在执行的操作", "warning"),
  "19-ambiguous": info("保存或提交结果不明确时保持当前页面", "不要用更多操作覆盖服务器记录", [
    ["不要连续点击", "避免产生重复或冲突请求"],
    ["不要切换题目", "保留当前上下文"],
    ["不要退出账号", "保留登录与页面状态"],
    ["不要清除数据", "保留本机缓存和现场证据"],
  ], "等待现场人员核实服务器记录", "warning"),
  "19-authority": info("未经同意不得自行改变比赛环境", "处置决定由组委会依据现场记录作出", [
    ["不重启服务器", "不自行操作系统设备"],
    ["不调整网络", "不改变竞赛网络设置"],
    ["不替换账号", "保持本人正式身份"],
    ["不更换电脑", "更换需现场批准"],
  ], "补时、重做或设备更换由组委会统一判定", "warning"),
  "19-report": info("报告异常时提供四项信息", "信息越完整，现场核实越准确", [
    ["发生时间", "异常首次出现的时间"],
    ["当前题目", "题目名称和当前状态"],
    ["执行操作", "保存、上传、提交或调用"],
    ["页面提示", "完整说明错误和结果"],
  ], "不自行尝试绕过系统控制"),

  "20-before": info("赛前完成四项检查", "准备工作决定现场操作是否稳定", [
    ["设备", "电脑、电源和网络接口"],
    ["离线环境", "软件、知识库和规范资料"],
    ["本地知识库", "原文、版本和条款定位"],
    ["答题流程", "调用、保存、恢复和提交"],
  ]),
  "20-during": info("正式比赛牢记四项要求", "每一步都以页面明确结果为准", [
    ["指定网络", "不连接外网和外部模型"],
    ["人工核验", "回到材料和规范原文"],
    ["多次保存", "看到已保存再切换"],
    ["逐题提交", "确认无误后锁定"],
  ]),
  "20-end": { type: "end" },
};

function run(command, args, options = {}) {
  process.stdout.write(`[contestant-video] ${command} ${args.slice(0, 5).join(" ")}\n`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function probeDuration(file) {
  return Number(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", file,
  ], { encoding: "utf8" }).trim());
}

function srtTime(seconds) {
  const totalMs = Math.max(0, Math.round(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function addHeader(args, title, subtitle) {
  args.push(
    "-fill", "#0c3558", "-draw", "rectangle 0,0 1920,178",
    "-fill", "#38a482", "-draw", "rectangle 0,178 1920,192",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "42",
    "-gravity", "northwest", "-annotate", "+118+48", "2026 年江苏省生态环境监测技能竞赛",
    "-font", regularFont, "-fill", "#cce4ec", "-pointsize", "24",
    "-annotate", "+120+112", "排污单位自行监测质量 AI 核查赛道 · 选手操作说明",
    "-font", boldFont, "-fill", "#183943", "-pointsize", "50",
    "-annotate", "+120+232", title,
    "-font", regularFont, "-fill", "#657a7f", "-pointsize", "27",
    "-annotate", "+122+300", subtitle,
  );
}

function addCheck(args, x, y, accent) {
  args.push(
    "-fill", accent, "-stroke", "none", "-draw", `circle ${x},${y} ${x},${y - 25}`,
    "-fill", "none", "-stroke", "#ffffff", "-strokewidth", "6",
    "-draw", `polyline ${x - 13},${y} ${x - 3},${y + 11} ${x + 17},${y - 13}`,
    "-stroke", "none",
  );
}

function makeInfoFrame(spec, output) {
  const args = ["-size", `${width}x${height}`, "xc:#f4f7f6"];
  addHeader(args, spec.title, spec.subtitle);
  const warning = spec.layout === "warning";
  const accents = warning
    ? ["#a95646", "#b26b3d", "#9d4d58", "#8b5e47", "#a95646", "#b26b3d"]
    : ["#2d7a94", "#318569", "#a57427", "#805d8e", "#9b5547", "#3d7280"];
  const count = spec.items.length;
  const cards = [];

  if (count === 5 || spec.layout === "flow") {
    const gap = count === 5 ? 28 : 42;
    const cardWidth = count === 5 ? 304 : Math.floor((1680 - gap * (count - 1)) / count);
    for (let index = 0; index < count; index += 1) {
      cards.push({ x: 120 + index * (cardWidth + gap), y: 402, w: cardWidth, h: 380 });
    }
  } else if (count === 6) {
    for (let index = 0; index < count; index += 1) {
      cards.push({ x: 120 + (index % 3) * 568, y: 390 + Math.floor(index / 3) * 225, w: 520, h: 185 });
    }
  } else if (count === 3) {
    for (let index = 0; index < count; index += 1) {
      cards.push({ x: 120 + index * 568, y: 420, w: 520, h: 340 });
    }
  } else if (count === 2) {
    for (let index = 0; index < count; index += 1) {
      cards.push({ x: 120 + index * 860, y: 420, w: 820, h: 340 });
    }
  } else {
    for (let index = 0; index < count; index += 1) {
      cards.push({ x: 120 + (index % 2) * 860, y: 390 + Math.floor(index / 2) * 225, w: 820, h: 185 });
    }
  }

  for (let index = 0; index < count; index += 1) {
    const [title, detail] = spec.items[index];
    const card = cards[index];
    const accent = accents[index % accents.length];
    args.push(
      "-fill", "#ffffff", "-stroke", "#d7e0de", "-strokewidth", "2",
      "-draw", `roundrectangle ${card.x},${card.y} ${card.x + card.w},${card.y + card.h} 7,7`,
      "-stroke", "none", "-fill", accent,
      "-draw", `rectangle ${card.x},${card.y} ${card.x + 14},${card.y + card.h}`,
    );
    addCheck(args, card.x + 58, card.y + 67, accent);
    args.push(
      "-font", boldFont, "-fill", "#23464c", "-pointsize", count === 5 ? "30" : "32",
      "-annotate", `+${card.x + 105}+${card.y + 38}`, title,
      "-font", regularFont, "-fill", "#74868a", "-pointsize", count === 5 ? "22" : "24",
      "-annotate", `+${card.x + (count === 5 ? 36 : 105)}+${card.y + (count === 5 ? 145 : 98)}`, detail,
    );
  }

  if (spec.footer) {
    args.push(
      "-fill", warning ? "#f5e9e6" : "#e5f0ed", "-stroke", "none",
      "-draw", "roundrectangle 120,808 1800,884 6,6",
      "-fill", warning ? "#a95646" : "#318569", "-draw", "rectangle 120,808 134,884",
      "-font", regularFont, "-fill", warning ? "#74443c" : "#345b5e", "-pointsize", "26",
      "-annotate", `+174+834`, spec.footer,
    );
  }
  args.push(output);
  run("magick", args);
}

function sourcePath(name) {
  const sources = {
    login: path.join(sourceDir, "login-current.png"),
    answer: path.join(sourceDir, "notice-images", "image2.png"),
    legacyAnswer: path.join(repoDir, "video", "assets", "screens", "06-contestant-draft.png"),
    locked: path.join(repoDir, "video", "assets", "screens", "07-contestant-submitted-locked.png"),
    equipment: path.join(sourceDir, "generated", "equipment-preparation.png"),
    network: path.join(sourceDir, "generated", "isolated-network-workstation.png"),
    report: path.join(sourceDir, "generated", "raise-hand-report.png"),
    cherryHome: path.join(sourceDir, "official", "cherry-studio-home.png"),
    cherryRecall: path.join(sourceDir, "official", "cherry-studio-recall.png"),
    cherryProvider: path.join(sourceDir, "official", "cherry-studio-provider.png"),
    dify: path.join(sourceDir, "official", "dify-workflow.png"),
    langchain: path.join(sourceDir, "official", "langchain.png"),
    llamaindex: path.join(sourceDir, "official", "llamaindex.png"),
    milvus: path.join(sourceDir, "official", "milvus-attu.png"),
    eventVisual: path.join(repoDir, "主视觉.jpg"),
  };
  const source = sources[name];
  if (!source || !existsSync(source)) throw new Error(`缺少画面素材：${name}`);
  return source;
}

const v2FrameSources = {
  "03-equipment": "equipment",
  "04-check": "preparationChecklist",
  "06-login": "login",
  "07-nav": "answer",
  "08-credentials": "apiDemo",
  "08-models": "apiDemo",
  "08-security": "apiTransitionNotice",
  "09-fields": "cherryProvider",
  "10-pipeline": "cherryRecall",
  "10-errors": "terminalErrors",
  "11-flow": "answer",
  "11-save": "answer",
  "11-lock": "locked",
  "12-network": "network",
  "12-login": "login",
  "12-discipline": "answer",
  "13-wait": "waiting",
  "14-question": "answer",
  "14-boundary": "evidenceMontage",
  "15-retrieval": "cherryRecall",
  "15-classify": "cherryRecall",
  "15-structure": "evidenceMontage",
  "16-editor": "answer",
  "16-upload": "answer",
  "16-save": "answer",
  "17-detect": "restore",
  "18-check": "answer",
  "18-confirm": "confirm",
  "18-lock": "locked",
  "19-errors": "report",
  "19-ambiguous": "report",
  "19-report": "report",
  "20-end": "closingText",
};

const v2Copy = {
  "05-search": ["检索结果必须能够回到原文", "软件示例 · Cherry Studio 官方召回测试"],
  "06-login": ["进入赛前测试环境", "测试账号和地址以组委会通知为准"],
  "06-identity": ["登录后先核对本人信息", "确认姓名、账号、测试模式和连接状态"],
  "07-nav": ["进入答题工作台", "模型和知识库验证完成后，再演练答题流程"],
  "08-credentials": ["复制完整的 API URL 和 API Key", "演示凭证已隐藏，实际以本人页面为准"],
  "08-bearer": ["API Key 放入 Bearer 凭证", "网页登录密码不能用于模型调用"],
  "08-models": ["模型 ID 直接从页面复制", "禁止简称、旧名称和大小写变更"],
  "09-fields": ["以 Cherry Studio 为例配置模型服务", "填写 API 密钥、API 地址并获取模型列表"],
  "09-errors": ["出现失败先核对三个位置", "完整地址、本人凭证、准确模型 ID"],
  "10-endpoints": ["先完成两个最小接口调用", "查询模型列表，再发送一条短文本请求"],
  "10-errors": ["根据状态码判断下一步", "不要用高频重试掩盖配置问题"],
  "11-save": ["保存草稿要看到明确结果", "等待“正在保存”变为“已保存”"],
  "11-lock": ["测试题提交后同样锁定", "赛前先熟悉不可撤回规则"],
  "13-wait": ["比赛未开始时保持页面开启", "评委开始后题目将自动显示"],
  "14-question": ["先完整阅读题目和附件", "确认材料范围、作答要求和提交形式"],
  "15-retrieval": ["从模型线索回到原文核验", "材料位置和规范条款共同支撑结论"],
  "16-editor": ["在“我的回答”区域组织答案", "使用标题、列表、引用和附件表达证据链"],
  "16-save": ["点击保存草稿后等待状态变化", "确认“已保存”再切换题目"],
  "18-lock": ["当前题已正式交卷", "内容立即锁定，刷新后仍不能修改"],
};

const v2SourceLabels = {
  cherryHome: "官方页面 · Cherry Studio",
  cherryRecall: "官方文档 · Cherry Studio 知识库召回",
  cherryProvider: "官方文档 · Cherry Studio 自定义服务商",
  dify: "官方文档 · Dify Workflow",
  langchain: "官方页面 · LangChain",
  llamaindex: "官方页面 · LlamaIndex",
  milvus: "官方文档 · Milvus Attu",
};

function v2SourceForFrame(frameId) {
  return v2FrameSources[frameId] ?? null;
}

function v2TitleForFrame(frameId, spec) {
  if (v2Copy[frameId]) return v2Copy[frameId];
  if (spec?.title) return [spec.title, spec.subtitle ?? ""];
  return ["选手操作说明", "按页面实际状态完成确认"];
}

function makePreparationChecklist(output) {
  const logoDefinitions = [
    { source: "cherry-studio-home.png", crop: "190x60+280+20", size: "150x44", x: 115, y: 305 },
    { source: "dify-workflow.png", crop: "75x55+20+5", size: "100x44", x: 430, y: 305 },
    { source: "langchain.png", crop: "170x60+150+15", size: "160x44", x: 690, y: 305 },
    { source: "llamaindex.png", crop: "145x50+55+65", size: "140x44", x: 120, y: 575 },
    { source: "milvus-attu.png", crop: "105x50+40+60", size: "140x44", x: 410, y: 575 },
  ];
  const logoFiles = logoDefinitions.map((logo, index) => {
    const logoFile = path.join(path.dirname(output), `preparation-logo-${index}.png`);
    run("magick", [
      path.join(sourceDir, "official", logo.source), "-crop", logo.crop, "+repage",
      "-trim", "+repage", "-resize", logo.size, logoFile,
    ]);
    return logoFile;
  });
  const args = [
    "-size", `${width}x${height}`, "xc:#edf2f1",
    "-fill", "#102b3a", "-draw", "rectangle 0,0 1920,110",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "42", "-gravity", "northwest",
    "-annotate", "+48+18", "本地知识库与规范资料",
    "-font", regularFont, "-fill", "#c9dadd", "-pointsize", "22",
    "-annotate", "+50+68", "内容和工具均由选手自行准备",
    "-fill", "#d3dfdc", "-draw", "rectangle 958,155 960,820",
    "-font", boldFont, "-fill", "#315f50", "-pointsize", "30",
    "-annotate", "+70+155", "本地知识库工具（选手自选）",
    "-annotate", "+1020+155", "所需规范资料",
  ];

  const logoTiles = [
    [70, 230], [355, 230], [640, 230],
    [70, 500], [355, 500], [640, 500],
  ];
  for (const [x, y] of logoTiles) {
    args.push(
      "-fill", "#ffffff", "-stroke", "#d5e0de", "-strokewidth", "2",
      "-draw", `roundrectangle ${x},${y} ${x + 245},${y + 195} 5,5`, "-stroke", "none",
    );
  }
  logoDefinitions.forEach((logo, index) => {
    args.push(
      logoFiles[index], "-gravity", "northwest", "-geometry", `+${logo.x}+${logo.y}`, "-composite",
    );
  });
  args.push(
    "-font", boldFont, "-fill", "#64787c", "-pointsize", "38",
    "-annotate", "+718+562", "其他",
  );

  const documentTypes = [
    { extension: "PDF", label: "PDF 文档", color: "#d84c4c", x: 1040, y: 240 },
    { extension: "DOCX", label: "Word 文档", color: "#3568b8", x: 1435, y: 240 },
    { extension: "XLSX", label: "表格文件", color: "#319264", x: 1040, y: 520 },
    { extension: "其他", label: "其他资料", color: "#65777c", x: 1435, y: 520 },
  ];
  for (const document of documentTypes) {
    args.push(
      "-fill", "#ffffff", "-stroke", "#d5e0de", "-strokewidth", "2",
      "-draw", `roundrectangle ${document.x},${document.y} ${document.x + 330},${document.y + 210} 5,5`,
      "-stroke", "none", "-fill", document.color,
      "-draw", `rectangle ${document.x},${document.y} ${document.x + 14},${document.y + 210}`,
      "-font", boldFont, "-fill", document.color, "-pointsize", "44",
      "-annotate", `+${document.x + 42}+${document.y + 42}`, document.extension,
      "-font", regularFont, "-fill", "#52666b", "-pointsize", "25",
      "-annotate", `+${document.x + 44}+${document.y + 130}`, document.label,
    );
  }
  args.push(output);
  run("magick", args);
}

function makeSoftwareMontage(output) {
  const files = ["cherryHome", "dify", "langchain", "llamaindex", "milvus"];
  const labels = ["Cherry Studio", "Dify", "LangChain", "LlamaIndex", "Milvus / Attu"];
  const args = ["-size", `${width}x${height}`, "xc:#edf2f1"];
  files.forEach((name, index) => {
    const cellWidth = 360;
    const x = 40 + index * 376;
    const thumb = path.join(path.dirname(output), `software-${index}.png`);
    run("magick", [
      sourcePath(name), "-auto-orient", "-resize", `${cellWidth}x570`, "-background", "#f3f6f5",
      "-gravity", "center", "-extent", `${cellWidth}x570`, thumb,
    ]);
    args.push(
      thumb, "-gravity", "northwest", "-geometry", `+${x}+150`, "-composite",
      "-fill", "rgba(8,28,42,0.90)", "-draw", `rectangle ${x},720 ${x + cellWidth},830`,
      "-font", boldFont, "-fill", "#ffffff", "-pointsize", "28",
      "-gravity", "northwest", "-annotate", `+${x + 24}+752`, labels[index],
    );
  });
  args.push(
    "-font", boldFont, "-fill", "#173f48", "-pointsize", "46", "-gravity", "northwest",
    "-annotate", "+48+45", "本地知识库工具示例",
    "-font", regularFont, "-fill", "#587176", "-pointsize", "26",
    "-annotate", "+50+100", "任选熟悉工具；后续操作以 Cherry Studio 为例",
    output,
  );
  run("magick", args);
}

function makeEvidenceMontage(output) {
  const left = path.join(path.dirname(output), "evidence-left.png");
  const right = path.join(path.dirname(output), "evidence-right.png");
  run("magick", [sourcePath("cherryRecall"), "-resize", "900x610", "-background", "#eef2f1", "-gravity", "center", "-extent", "900x610", left]);
  run("magick", [sourcePath("answer"), "-resize", "900x610", "-background", "#eef2f1", "-gravity", "center", "-extent", "900x610", right]);
  run("magick", [
    "-size", `${width}x${height}`, "xc:#dde5e4",
    left, "-gravity", "northwest", "-geometry", "+40+190", "-composite",
    right, "-gravity", "northwest", "-geometry", "+980+190", "-composite",
    "-fill", "#38a482", "-draw", "rectangle 950,190 970,800",
    "-fill", "#102b3a", "-draw", "rectangle 0,0 1920,110",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "44", "-gravity", "northwest",
    "-annotate", "+60+28", "左侧找来源，右侧写证据链",
    "-font", regularFont, "-fill", "#315f50", "-pointsize", "28",
    "-annotate", "+350+830", "知识库召回结果（完整页面）",
    "-annotate", "+1270+830", "在线答题页面（完整页面）",
    output,
  ]);
}

function makeTerminalFrame(output, errors = false) {
  const lines = errors
    ? [
        ["401", "invalid_api_key", "检查 API Key"],
        ["400", "model_not_allowed", "重新复制模型 ID"],
        ["429", "rate_limit_exceeded", "降低频率后重试"],
        ["503", "service_suspended", "停止调用并报告"],
      ]
    : [
        ["$", "GET /v1/models", "返回允许模型列表"],
        ["$", "POST /v1/chat/completions", "返回一条短文本结果"],
      ];
  const args = [
    "-size", `${width}x${height}`, "xc:#101820",
    "-fill", "#1e2b34", "-draw", "roundrectangle 100,100 1820,890 8,8",
    "-fill", "#2b3b45", "-draw", "rectangle 100,100 1820,175",
    "-fill", "#e05a4f", "-draw", "circle 145,137 145,125",
    "-fill", "#d9a441", "-draw", "circle 185,137 185,125",
    "-fill", "#38a482", "-draw", "circle 225,137 225,125",
    "-font", boldFont, "-fill", "#d9e6e2", "-pointsize", "36", "-gravity", "northwest",
    "-annotate", "+130+220", errors ? "接口状态判断" : "最小接口调用",
  ];
  lines.forEach((row, index) => {
    const y = 330 + index * (errors ? 125 : 210);
    args.push(
      "-font", boldFont, "-fill", errors ? "#e2a66f" : "#67c7a5", "-pointsize", "36",
      "-annotate", `+150+${y}`, row[0],
      "-fill", "#ffffff", "-pointsize", "34", "-annotate", `+280+${y}`, row[1],
      "-font", regularFont, "-fill", "#a9bdc5", "-pointsize", "28", "-annotate", `+1030+${y + 3}`, row[2],
    );
  });
  args.push(output);
  run("magick", args);
}

function makeClosingTextFrame(output) {
  run("magick", [
    "-size", `${width}x${height}`, "xc:#edf2f1",
    "-font", boldFont, "-fill", "#173f48", "-pointsize", "52", "-gravity", "center",
    "-annotate", "+0-125", "比赛中使用指定网络",
    "-font", regularFont, "-fill", "#315f50", "-pointsize", "42",
    "-annotate", "+0+0", "核验材料和依据，及时保存并按要求提交",
    "-fill", "#526b70", "-pointsize", "38",
    "-annotate", "+0+120", "发生异常立即报告，具体安排以最新通知为准",
    output,
  ]);
}

function makeApiTransitionNotice(output) {
  run("magick", [
    "-size", `${width}x${height}`, "xc:#edf2f1",
    "-fill", "#102b3a", "-draw", "rectangle 0,0 1920,110",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "42", "-gravity", "northwest",
    "-annotate", "+48+18", "正式比赛配置原则",
    "-font", regularFont, "-fill", "#c9dadd", "-pointsize", "22",
    "-annotate", "+50+68", "测试阶段完成配置，正式比赛仅替换一项信息",

    "-fill", "#38a482", "-draw", "roundrectangle 100,235 188,323 6,6",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "30",
    "-annotate", "+122+250", "01",
    "-font", boldFont, "-fill", "#173f48", "-pointsize", "44",
    "-annotate", "+245+220", "API Key 仅限本人测试使用",
    "-font", regularFont, "-fill", "#60757a", "-pointsize", "31",
    "-annotate", "+248+290", "不得共享、公开",
    "-fill", "#cedbd8", "-draw", "rectangle 245,365 1780,368",

    "-fill", "#38a482", "-draw", "roundrectangle 100,480 188,568 6,6",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "30",
    "-annotate", "+122+495", "02",
    "-font", boldFont, "-fill", "#173f48", "-pointsize", "42",
    "-annotate", "+245+465", "正式比赛仅替换现场局域网 API URL",
    "-font", regularFont, "-fill", "#60757a", "-pointsize", "30",
    "-annotate", "+248+538", "登录账号密码、API Key、模型 ID 与测试环境一致",
    "-fill", "#cedbd8", "-draw", "rectangle 245,615 1780,618",

    "-fill", "#dcebe6", "-draw", "rectangle 100,710 1820,850",
    "-font", boldFont, "-fill", "#285f50", "-pointsize", "34",
    "-annotate", "+155+752", "现场提供：局域网 API URL",
    "-font", regularFont, "-fill", "#56716a", "-pointsize", "27",
    "-annotate", "+820+757", "其余信息沿用测试环境配置",
    output,
  ]);
}

function makeApiDemoFrame(frameId, output) {
  const [title, subtitle] = v2TitleForFrame(frameId, frameSpecs[frameId]);
  const args = [
    "-size", `${width}x${height}`, "xc:#eef1f2",
    "-fill", "#202428", "-draw", "rectangle 0,0 1920,112",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "27", "-gravity", "northwest",
    "-annotate", "+44+34", "江苏省监测技能竞赛在线答题系统",
    "-font", regularFont, "-fill", "#b9c4c7", "-pointsize", "20", "-annotate", "+44+72", "选手答题端 · API 技术文档",
    "-fill", "#ffffff", "-draw", "rectangle 0,112 1920,176",
    "-font", boldFont, "-fill", "#315f50", "-pointsize", "22", "-annotate", "+55+132", "答题工作台      API 技术文档",
    "-font", boldFont, "-fill", "#21444b", "-pointsize", "46", "-annotate", "+80+225", title,
    "-font", regularFont, "-fill", "#6c7f83", "-pointsize", "27", "-annotate", "+82+290", subtitle,
  ];
  if (frameId === "08-models") {
    args.push(
      "-fill", "#ffffff", "-stroke", "#d4dddd", "-strokewidth", "2", "-draw", "roundrectangle 80,360 1840,860 6,6",
      "-stroke", "none", "-fill", "#edf3f1", "-draw", "rectangle 110,395 1810,462",
      "-font", boldFont, "-fill", "#54686d", "-pointsize", "23",
      "-annotate", "+150+415", "模型 ID", "-annotate", "+760+415", "模型名称", "-annotate", "+1250+415", "支持输入",
    );
    const rows = [
      ["deepseek-v4-flash", "DeepSeek V4 Flash", "文本"],
      ["qwen3.8-max", "Qwen 3.8 Max", "文本 · 图片 · 视频"],
      ["ZHIPU/GLM-5.3", "GLM-5.3", "文本"],
      ["kimi/kimi-k3", "Kimi K3", "文本 · 图片 · 视频"],
    ];
    rows.forEach((row, index) => {
      const y = 510 + index * 78;
      args.push(
        "-font", boldFont, "-fill", "#2d654f", "-pointsize", "25", "-annotate", `+150+${y}`, row[0],
        "-font", regularFont, "-fill", "#35474c", "-pointsize", "25", "-annotate", `+760+${y}`, row[1],
        "-fill", "#667a7e", "-annotate", `+1250+${y}`, row[2],
      );
    });
  } else {
    args.push(
      "-fill", "#ffffff", "-stroke", "#d4dddd", "-strokewidth", "2", "-draw", "roundrectangle 80,360 1840,820 6,6",
      "-stroke", "none", "-font", boldFont, "-fill", "#315f50", "-pointsize", "23", "-annotate", "+125+402", "API URL",
      "-fill", "#f4f7f6", "-draw", "roundrectangle 120,450 1800,535 5,5",
      "-font", regularFont, "-fill", "#24454d", "-pointsize", "31", "-annotate", "+160+477", "http://competition.local/v1     [演示地址]",
      "-font", boldFont, "-fill", "#315f50", "-pointsize", "23", "-annotate", "+125+590", "API KEY",
      "-fill", "#f4f7f6", "-draw", "roundrectangle 120,638 1800,723 5,5",
      "-font", regularFont, "-fill", "#24454d", "-pointsize", "31", "-annotate", "+160+665", "sk-demo-••••••••••••••••     [已隐藏]",
    );
  }
  args.push(output);
  run("magick", args);
}

function makeVisualV2(frameId, spec, output) {
  const sourceName = v2SourceForFrame(frameId);
  if (!sourceName) return false;
  if (sourceName === "preparationChecklist") { makePreparationChecklist(output); return true; }
  if (sourceName === "softwareMontage") { makeSoftwareMontage(output); return true; }
  if (sourceName === "evidenceMontage") { makeEvidenceMontage(output); return true; }
  if (sourceName === "terminal") { makeTerminalFrame(output, false); return true; }
  if (sourceName === "terminalErrors") { makeTerminalFrame(output, true); return true; }
  if (sourceName === "closingText") { makeClosingTextFrame(output); return true; }
  if (sourceName === "apiTransitionNotice") { makeApiTransitionNotice(output); return true; }
  if (sourceName === "apiDemo") { makeApiDemoFrame(frameId, output); return true; }
  if (["waiting", "restore", "confirm"].includes(sourceName)) return false;

  const [title, subtitle] = v2TitleForFrame(frameId, spec);
  const source = sourcePath(sourceName);
  const media = path.join(path.dirname(output), `${frameId}-contained.png`);
  run("magick", [
    source, "-auto-orient", "-resize", "1920x820", "-background", "#e5ebea",
    "-gravity", "center", "-extent", "1920x820", media,
  ]);
  const args = [
    "-size", `${width}x${height}`, "xc:#e5ebea",
    "-fill", "#102b3a", "-draw", "rectangle 0,0 1920,110",
    media, "-gravity", "northwest", "-geometry", "+0+110", "-composite",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "38", "-gravity", "northwest",
    "-annotate", "+48+18", title,
    "-font", regularFont, "-fill", "#c9dadd", "-pointsize", "22", "-annotate", "+50+67", subtitle,
  ];
  const sourceLabel = v2SourceLabels[sourceName];
  if (sourceLabel) {
    args.push(
      "-font", boldFont, "-fill", "#9fc5bb", "-pointsize", "19", "-gravity", "northeast",
      "-annotate", "+45+70", sourceLabel,
    );
  }
  args.push(output);
  run("magick", args);
  return true;
}

function makeScreenFrame(spec, output) {
  if (spec.source === "login") {
    const args = [
      sourcePath(spec.source), "-resize", "1920x1080!",
      "-fill", "rgba(8,32,48,0.92)", "-stroke", "none",
      "-draw", "roundrectangle 90,585 650,880 7,7",
    ];
    spec.labels.forEach((label, index) => {
      const y = 655 + index * 105;
      args.push(
        "-fill", index === 0 ? "#d9a441" : "#38a482", "-draw", `circle 145,${y} 145,${y - 19}`,
        "-font", boldFont, "-fill", "#ffffff", "-pointsize", "25", "-annotate", `+190+${y - 18}`, label,
      );
    });
    args.push(output);
    run("magick", args);
    return;
  }
  const labelTop = 730;
  const labelWidth = Math.floor(1640 / spec.labels.length) - 22;
  const args = [
    sourcePath(spec.source), "-resize", "1920x1080!",
    "-fill", "rgba(8,32,48,0.90)", "-stroke", "none",
    "-draw", "roundrectangle 90,712 1830,892 7,7",
  ];
  for (let index = 0; index < spec.labels.length; index += 1) {
    const x = 130 + index * (labelWidth + 32);
    args.push(
      "-fill", index === 0 ? "#d9a441" : "#38a482",
      "-draw", `circle ${x + 22},${labelTop + 47} ${x + 22},${labelTop + 27}`,
      "-font", boldFont, "-fill", "#ffffff", "-pointsize", "25",
      "-annotate", `+${x + 58}+${labelTop + 25}`, spec.labels[index],
    );
  }
  args.push(output);
  run("magick", args);
}

function apiShellArgs(title, subtitle) {
  const args = ["-size", `${width}x${height}`, "xc:#f4f7f6"];
  addHeader(args, title, subtitle);
  args.push(
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2",
    "-draw", "roundrectangle 120,370 1800,875 7,7",
    "-stroke", "none",
  );
  return args;
}

function makeApiFrame(spec, output) {
  let args;
  if (spec.variant === "credentials") {
    args = apiShellArgs("复制完整的模型接入信息", "页面内容为演示值，实际以本人页面为准");
    args.push(
      "-font", boldFont, "-fill", "#315f50", "-pointsize", "24", "-annotate", "+165+416", "API URL",
      "-fill", "#f5f8f7", "-draw", "roundrectangle 160,468 1760,560 5,5",
      "-font", regularFont, "-fill", "#24454d", "-pointsize", "31", "-annotate", "+195+496", "http://competition.local/v1    [演示地址]",
      "-font", boldFont, "-fill", "#315f50", "-pointsize", "24", "-annotate", "+165+620", "API KEY",
      "-fill", "#f5f8f7", "-draw", "roundrectangle 160,672 1760,764 5,5",
      "-font", regularFont, "-fill", "#24454d", "-pointsize", "31", "-annotate", "+195+700", "sk-demo-••••••••••••••••    [已隐藏]",
      "-font", boldFont, "-fill", "#a95646", "-pointsize", "27", "-annotate", "+160+815", "API URL 已包含 /v1，不得重复拼接",
    );
  } else if (spec.variant === "bearer") {
    args = apiShellArgs("API Key 放入 Bearer 凭证", "网页登录密码不能用于模型调用");
    args.push(
      "-fill", "#17242a", "-draw", "roundrectangle 160,430 1760,710 6,6",
      "-font", regularFont, "-fill", "#9fc7ba", "-pointsize", "27", "-annotate", "+210+486", "HTTP Header",
      "-font", boldFont, "-fill", "#ffffff", "-pointsize", "38", "-annotate", "+210+570", "Authorization: Bearer <API_KEY>",
      "-fill", "#e5f0ed", "-draw", "roundrectangle 160,750 1760,830 6,6",
      "-font", regularFont, "-fill", "#345b5e", "-pointsize", "28", "-annotate", "+205+778", "凭证字段只填写本人 API Key，画面和日志中必须完整遮挡",
    );
  } else if (spec.variant === "models") {
    args = apiShellArgs("模型 ID 必须准确复制", "禁止简称、旧名称和大小写变更");
    const rows = [
      ["deepseek-v4-flash", "DeepSeek V4 Flash", "文本"],
      ["qwen3.8-max", "Qwen 3.8 Max", "文本 · 图片 · 视频"],
      ["ZHIPU/GLM-5.3", "GLM-5.3", "文本"],
    ];
    args.push(
      "-fill", "#eef3f1", "-draw", "rectangle 160,415 1760,480",
      "-font", boldFont, "-fill", "#52676c", "-pointsize", "23",
      "-annotate", "+195+435", "模型 ID", "-annotate", "+720+435", "模型名称", "-annotate", "+1190+435", "支持输入",
    );
    rows.forEach((row, index) => {
      const y = 510 + index * 92;
      args.push(
        "-fill", index % 2 === 0 ? "#ffffff" : "#f8faf9", "-draw", `rectangle 160,${y - 18} 1760,${y + 66}`,
        "-font", boldFont, "-fill", "#2d654f", "-pointsize", "25", "-annotate", `+195+${y}`, row[0],
        "-font", regularFont, "-fill", "#35474c", "-pointsize", "25", "-annotate", `+720+${y}`, row[1],
        "-fill", "#647a7e", "-annotate", `+1190+${y}`, row[2],
      );
    });
    args.push("-font", boldFont, "-fill", "#a95646", "-pointsize", "26", "-annotate", "+160+815", "最终允许模型以现场系统页面为准");
  } else if (spec.variant === "endpoints") {
    args = apiShellArgs("先完成两个最小接口调用", "先验证身份和模型，再接入知识库");
    args.push(
      "-fill", "#e8f0ed", "-draw", "roundrectangle 170,430 1740,585 6,6",
      "-fill", "#318569", "-draw", "roundrectangle 210,472 330,542 5,5",
      "-font", boldFont, "-fill", "#ffffff", "-pointsize", "28", "-annotate", "+235+490", "GET",
      "-fill", "#23464c", "-pointsize", "34", "-annotate", "+390+480", "/models",
      "-font", regularFont, "-fill", "#687d82", "-pointsize", "26", "-annotate", "+390+530", "查询当前允许调用的模型",
      "-fill", "#f2ebdd", "-draw", "roundrectangle 170,625 1740,780 6,6",
      "-fill", "#a57427", "-draw", "roundrectangle 210,667 330,737 5,5",
      "-font", boldFont, "-fill", "#ffffff", "-pointsize", "26", "-annotate", "+222+685", "POST",
      "-fill", "#23464c", "-pointsize", "34", "-annotate", "+390+675", "/chat/completions",
      "-font", regularFont, "-fill", "#687d82", "-pointsize", "26", "-annotate", "+390+725", "发送一条简短对话请求",
    );
  } else {
    args = apiShellArgs("根据状态码判断下一步", "不要用高频重复请求掩盖配置问题");
    const errors = [
      ["401", "invalid_api_key", "检查 API Key"],
      ["400", "model_not_allowed", "重新复制模型 ID"],
      ["429", "rate_limit_exceeded", "降低频率后重试"],
      ["503", "service_suspended", "停止调用并报告"],
    ];
    errors.forEach((row, index) => {
      const y = 420 + index * 105;
      args.push(
        "-fill", index % 2 === 0 ? "#f8faf9" : "#ffffff", "-draw", `rectangle 160,${y} 1760,${y + 86}`,
        "-font", boldFont, "-fill", index === 3 ? "#a95646" : "#a57427", "-pointsize", "28", "-annotate", `+195+${y + 22}`, row[0],
        "-fill", "#27474d", "-pointsize", "26", "-annotate", `+390+${y + 22}`, row[1],
        "-font", regularFont, "-fill", "#6b7e82", "-pointsize", "25", "-annotate", `+1120+${y + 22}`, row[2],
      );
    });
  }
  args.push(output);
  run("magick", args);
}

function makeConfigFrame(spec, output) {
  const args = apiShellArgs(
    spec.variant === "fields" ? "在本地工具中配置三个核心值" : "优先排查三个常见配置错误",
    spec.variant === "fields" ? "字段名称可以不同，值的含义必须一致" : "先核对配置，再判断服务是否异常",
  );
  if (spec.variant === "fields") {
    const fields = [
      ["协议", "OpenAI Chat Completions"],
      ["Base URL", "http://competition.local/v1  [演示]"],
      ["API Key", "••••••••••••••••  [已隐藏]"],
      ["模型 ID", "qwen3.8-max"],
    ];
    fields.forEach((field, index) => {
      const y = 410 + index * 105;
      args.push(
        "-font", boldFont, "-fill", "#315f50", "-pointsize", "23", "-annotate", `+180+${y + 20}`, field[0],
        "-fill", "#f5f8f7", "-draw", `roundrectangle 540,${y} 1700,${y + 72} 5,5`,
        "-font", regularFont, "-fill", "#24454d", "-pointsize", "28", "-annotate", `+580+${y + 18}`, field[1],
      );
    });
  } else {
    const rows = [
      ["重复添加 /v1", "使用页面完整 API URL"],
      ["把登录密码当作 API Key", "填写本人模型调用凭证"],
      ["使用简称或改变大小写", "直接复制准确模型 ID"],
    ];
    rows.forEach((row, index) => {
      const y = 425 + index * 135;
      args.push(
        "-fill", "#f5e9e6", "-draw", `roundrectangle 170,${y} 1740,${y + 100} 6,6`,
        "-font", boldFont, "-fill", "#8b4e42", "-pointsize", "28", "-annotate", `+220+${y + 26}`, row[0],
        "-font", regularFont, "-fill", "#65797e", "-pointsize", "26", "-annotate", `+1050+${y + 27}`, row[1],
      );
    });
  }
  args.push(output);
  run("magick", args);
}

function makeKnowledgeFrame(spec, output) {
  const verify = spec.variant === "verify";
  const args = ["-size", `${width}x${height}`, "xc:#f4f7f6"];
  addHeader(args, verify ? "从模型线索回到原文核验" : "检索结果必须能够回到原文", verify ? "模型辅助发现问题，材料和条款支撑结论" : "演示内容不对应任何正式赛题");
  args.push(
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2", "-draw", "roundrectangle 120,380 480,870 6,6",
    "-stroke", "none", "-font", boldFont, "-fill", "#315f50", "-pointsize", "27", "-annotate", "+160+420", "资料分类",
  );
  ["管理规定", "行业技术指南", "手工监测规范", "自动监测规范", "监督检查规程"].forEach((label, index) => {
    args.push("-font", regularFont, "-fill", "#536b70", "-pointsize", "24", "-annotate", `+175+${490 + index * 66}`, label);
  });
  args.push(
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2", "-draw", "roundrectangle 520,380 1800,870 6,6",
    "-stroke", "none", "-fill", "#eef4f2", "-draw", "roundrectangle 560,420 1760,492 5,5",
    "-font", regularFont, "-fill", "#345b5e", "-pointsize", "25", "-annotate", "+600+442", verify ? "检索：监测频次与许可要求是否一致（演示）" : "检索：如何核对监测频次要求（演示）",
    "-font", boldFont, "-fill", "#25484e", "-pointsize", "29", "-annotate", "+570+548", "检索结果（演示）",
    "-font", regularFont, "-fill", "#526b70", "-pointsize", "25", "-annotate", "+570+608", "原文：监测项目和频次应与适用要求逐项核对。",
    "-fill", "#6e8286", "-pointsize", "23", "-annotate", "+570+666", "文件：自行监测技术指南（演示文件）",
    "-annotate", "+570+713", "版本：演示版    条款位置：第 5.2 条（演示）",
    "-fill", verify ? "#f2ebdd" : "#e5f0ed", "-draw", "roundrectangle 560,770 1760,835 5,5",
    "-font", boldFont, "-fill", verify ? "#805d30" : "#315f50", "-pointsize", "25",
    "-annotate", "+600+790", verify ? "下一步：回到档案和有效规范原文逐项核验" : "结果必须同时保留原文、文件、版本和条款位置",
    output,
  );
  run("magick", args);
}

function makeWaitingFrame(output) {
  const args = ["-size", `${width}x${height}`, "xc:#eef1f2"];
  args.push(
    "-fill", "#f1dda0", "-draw", "rectangle 0,0 1920,52",
    "-font", boldFont, "-fill", "#6b5416", "-pointsize", "24", "-annotate", "+44+13", "比赛模式以现场状态为准",
    "-fill", "#202428", "-draw", "rectangle 0,52 1920,142",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "27", "-annotate", "+45+80", "江苏省监测技能竞赛在线答题系统",
    "-font", regularFont, "-fill", "#bec8cb", "-pointsize", "20", "-annotate", "+45+116", "选手答题端",
    "-fill", "#ffffff", "-draw", "rectangle 0,142 1920,205",
    "-font", boldFont, "-fill", "#315f50", "-pointsize", "23", "-annotate", "+55+162", "答题工作台",
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2", "-draw", "roundrectangle 560,325 1360,760 7,7",
    "-stroke", "none", "-fill", "#318569", "-draw", "circle 960,455 960,400",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "48", "-gravity", "center", "-annotate", "+0-85", "待",
    "-font", boldFont, "-fill", "#23464c", "-pointsize", "52", "-gravity", "center", "-annotate", "+0+55", "比赛未开始",
    "-font", regularFont, "-fill", "#6d8084", "-pointsize", "28", "-annotate", "+0+135", "请保持页面开启",
    "-annotate", "+0+190", "开始后题目将自动显示在左侧",
    output,
  );
  run("magick", args);
}

function makeRestoreFrame(spec, output) {
  const discard = spec.variant === "discard";
  const args = [
    sourcePath("answer"), "-resize", "1920x1080!",
    "-fill", "rgba(18,27,31,0.58)", "-draw", "rectangle 0,0 1920,1080",
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2",
    "-draw", "roundrectangle 300,300 1620,760 8,8",
    "-stroke", "none", "-fill", discard ? "#f5e9e6" : "#f2ebdd", "-draw", "rectangle 300,300 1620,390",
    "-gravity", "northwest", "-font", boldFont, "-fill", discard ? "#85483d" : "#805d30", "-pointsize", "36",
    "-annotate", "+370+328", discard ? "确认本机缓存已经无效后再丢弃" : "本机存有一份未保存的答案",
    "-font", regularFont, "-fill", "#536b70", "-pointsize", "28",
    "-annotate", "+370+445", "缓存时间：2026-08-27 09:18:30（演示）",
    "-annotate", "+370+510", discard ? "丢弃后，本机这份内容将不再用于恢复。" : "恢复后仍需点击保存草稿或最终提交。",
    "-fill", "#f0f3f2", "-draw", "roundrectangle 1050,630 1270,700 5,5",
    "-gravity", "center", "-font", boldFont, "-fill", "#52666b", "-pointsize", "26", "-annotate", "+200+125", "丢弃",
    "-fill", "#318569", "-draw", "roundrectangle 1290,630 1510,700 5,5",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "26", "-annotate", "+440+125", "恢复",
    output,
  ];
  run("magick", args);
}

function makeConfirmFrame(output) {
  const args = [
    sourcePath("answer"), "-resize", "1920x1080!",
    "-fill", "rgba(18,27,31,0.64)", "-draw", "rectangle 0,0 1920,1080",
    "-fill", "#ffffff", "-stroke", "#d6dfdd", "-strokewidth", "2", "-draw", "roundrectangle 520,325 1400,735 8,8",
    "-stroke", "none", "-gravity", "northwest", "-font", boldFont, "-fill", "#23464c", "-pointsize", "38", "-annotate", "+600+390", "确认最终提交",
    "-font", regularFont, "-fill", "#5f7479", "-pointsize", "30", "-annotate", "+600+480", "最终提交后不能再修改答案，确认提交？",
    "-fill", "#f0f3f2", "-draw", "roundrectangle 930,610 1110,675 5,5",
    "-gravity", "center", "-font", boldFont, "-fill", "#52666b", "-pointsize", "25", "-annotate", "+60+103", "取消",
    "-fill", "#318569", "-draw", "roundrectangle 1140,610 1320,675 5,5",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "25", "-annotate", "+270+103", "确认",
    output,
  ];
  run("magick", args);
}

function makeEndFrame(output) {
  const banner = path.join(path.dirname(output), "competition-banner.png");
  run("magick", [path.join(repoDir, "主视觉.jpg"), "-resize", "1920x768!", banner]);
  run("magick", [
    "-size", `${width}x${height}`, "xc:#edf6f8",
    banner, "-gravity", "north", "-geometry", "+0+0", "-composite",
    "-fill", "#0c3558", "-draw", "rectangle 0,700 1920,1080",
    "-fill", "#38a482", "-draw", "rectangle 0,700 1920,714",
    "-font", boldFont, "-fill", "#ffffff", "-pointsize", "56", "-gravity", "northwest",
    "-annotate", "+118+752", "按要求准备，按流程操作，按结果确认",
    "-font", regularFont, "-fill", "#cce4ec", "-pointsize", "29",
    "-annotate", "+122+835", "具体安排以正式竞赛指南及组委会最新通知为准",
    output,
  ]);
}

function makeBaseFrame(frameId, spec, output) {
  if (makeVisualV2(frameId, spec, output)) return;
  if (spec.type === "info") return makeInfoFrame(spec, output);
  if (spec.type === "screen") return makeScreenFrame(spec, output);
  if (spec.type === "api") return makeApiFrame(spec, output);
  if (spec.type === "config") return makeConfigFrame(spec, output);
  if (spec.type === "knowledge") return makeKnowledgeFrame(spec, output);
  if (spec.type === "waiting") return makeWaitingFrame(output);
  if (spec.type === "restore") return makeRestoreFrame(spec, output);
  if (spec.type === "confirm") return makeConfirmFrame(output);
  if (spec.type === "end") return makeEndFrame(output);
  throw new Error(`未知画面类型：${frameId} / ${spec.type}`);
}

function makeCaptionFrame(baseImage, text, output, workDir) {
  const caption = path.join(workDir, `${path.basename(output, ".png")}-caption.png`);
  run("magick", [
    "-background", "none", "-fill", "#ffffff", "-font", regularFont,
    "-pointsize", "32", "-gravity", "center", "-size", "1680x116",
    `caption:${text}`, caption,
  ]);
  run("magick", [
    baseImage,
    "-fill", "rgba(7,27,45,0.94)", "-draw", "rectangle 0,930 1920,1080",
    "-fill", "#38a482", "-draw", "rectangle 0,930 14,1080",
    caption, "-gravity", "northwest", "-geometry", "+120+950", "-composite",
    output,
  ]);
}

function synthesize(text, output) {
  run("say", ["-v", "Tingting", "-r", "165", "-o", output, text]);
}

function makeSegment(frame, audio, duration, output) {
  const fadeOut = Math.max(0.5, duration - 0.4).toFixed(3);
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error",
    "-loop", "1", "-framerate", String(fps), "-i", frame,
    "-i", audio,
    "-vf", `scale=1920:1080,fade=t=in:st=0:d=0.3,fade=t=out:st=${fadeOut}:d=0.4`,
    "-af", "apad=pad_dur=0.55", "-t", duration.toFixed(3), "-r", String(fps),
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
    "-movflags", "+faststart", output,
  ]);
}

function concatFiles(files, output, workDir) {
  const listFile = path.join(workDir, "segments.concat.txt");
  writeFileSync(listFile, files.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
  run("ffmpeg", [
    "-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0",
    "-i", listFile, "-c", "copy", "-movflags", "+faststart", output,
  ]);
}

const requested = process.argv[2] ?? "all";
const targetIds = requested === "all" ? Object.keys(shots).sort() : [requested.padStart(2, "0")];
for (const id of targetIds) {
  if (!shots[id]) throw new Error(`镜头 ${id} 不在本生成器范围内。可用范围为 02-12。`);
}

mkdirSync(shotsDir, { recursive: true });
mkdirSync(previewsDir, { recursive: true });
mkdirSync(workRoot, { recursive: true });

function removeGeneratedShotArtifacts(ids) {
  const prefixes = ids.map((id) => `${id}-`);
  for (const name of readdirSync(shotsDir)) {
    if (prefixes.some((prefix) => name.startsWith(prefix)) && /\.(?:mp4|srt|json)$/.test(name)) {
      rmSync(path.join(shotsDir, name), { force: true });
    }
  }
  for (const name of readdirSync(previewsDir)) {
    if (prefixes.some((prefix) => name.startsWith(prefix)) && name.endsWith(".png")) {
      rmSync(path.join(previewsDir, name), { force: true });
    }
  }
  for (const id of ids) {
    rmSync(path.join(workRoot, id), { recursive: true, force: true });
  }
}

const cleanupIds = requested === "all"
  ? Array.from({ length: 19 }, (_, index) => String(index + 2).padStart(2, "0"))
  : targetIds;
removeGeneratedShotArtifacts(cleanupIds);

const manifest = [];
for (const id of targetIds) {
  const shot = shots[id];
  const workDir = path.join(workRoot, id);
  const outputFile = path.join(shotsDir, `${id}-${shot.slug}.mp4`);
  const subtitleFile = path.join(shotsDir, `${id}-${shot.slug}.srt`);
  const infoFile = path.join(shotsDir, `${id}-${shot.slug}.json`);
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  rmSync(outputFile, { force: true });
  rmSync(subtitleFile, { force: true });
  rmSync(infoFile, { force: true });

  const segments = [];
  const subtitles = [];
  const sceneInfo = [];
  let start = 0;

  for (let index = 0; index < shot.scenes.length; index += 1) {
    const [frameId, text] = shot.scenes[index];
    const spec = frameSpecs[frameId];
    if (!spec) throw new Error(`镜头 ${id} 缺少画面定义：${frameId}`);
    const prefix = `${id}-${String(index + 1).padStart(2, "0")}`;
    const base = path.join(workDir, `${frameId}-base.png`);
    const frame = path.join(workDir, `${prefix}.png`);
    const audio = path.join(workDir, `${prefix}.aiff`);
    const segment = path.join(workDir, `${prefix}.mp4`);
    makeBaseFrame(frameId, spec, base);
    if (frameId === "20-end") run("magick", [base, frame]);
    else makeCaptionFrame(base, text, frame, workDir);
    synthesize(text, audio);
    const speechDuration = probeDuration(audio);
    const duration = speechDuration + 0.55;
    makeSegment(frame, audio, duration, segment);
    segments.push(segment);
    subtitles.push(`${index + 1}\n${srtTime(start)} --> ${srtTime(start + speechDuration)}\n${text}\n`);
    sceneInfo.push({
      scene: index + 1,
      frame: frameId,
      speechDurationSeconds: Number(speechDuration.toFixed(3)),
      durationSeconds: Number(duration.toFixed(3)),
    });
    start += duration;
  }

  concatFiles(segments, outputFile, workDir);
  writeFileSync(subtitleFile, subtitles.join("\n"), "utf8");
  writeFileSync(infoFile, JSON.stringify({
    generatedAt: new Date().toISOString(),
    shot: id,
    title: shot.slug,
    voice: "Tingting",
    voiceRate: 165,
    durationSeconds: Number(start.toFixed(3)),
    video: path.basename(outputFile),
    subtitles: path.basename(subtitleFile),
    scenes: sceneInfo,
  }, null, 2) + "\n", "utf8");

  const previewTimes = [2, Math.max(2, start / 2), Math.max(2, start - 2)];
  for (let index = 0; index < previewTimes.length; index += 1) {
    run("ffmpeg", [
      "-y", "-hide_banner", "-loglevel", "error", "-ss", previewTimes[index].toFixed(3),
      "-i", outputFile, "-frames:v", "1",
      path.join(previewsDir, `${id}-${String(index + 1).padStart(2, "0")}.png`),
    ]);
  }
  manifest.push({
    shot: id,
    title: shot.slug,
    durationSeconds: Number(start.toFixed(3)),
    video: path.basename(outputFile),
  });
  process.stdout.write(`[contestant-video] shot ${id} complete: ${outputFile}\n`);
}

const completeManifest = Object.keys(shots).sort().flatMap((id) => {
  const shot = shots[id];
  const infoFile = path.join(shotsDir, `${id}-${shot.slug}.json`);
  if (!existsSync(infoFile)) return [];
  const metadata = JSON.parse(readFileSync(infoFile, "utf8"));
  return [{
    shot: id,
    title: shot.slug,
    durationSeconds: metadata.durationSeconds,
    video: metadata.video,
  }];
});

writeFileSync(path.join(shotsDir, "remaining-build-manifest.json"), JSON.stringify({
  generatedAt: new Date().toISOString(),
  mergedVideoCreated: false,
  shots: completeManifest,
}, null, 2) + "\n", "utf8");

process.stdout.write(`[contestant-video] complete: ${targetIds.length} independent shots; no merged video created.\n`);
