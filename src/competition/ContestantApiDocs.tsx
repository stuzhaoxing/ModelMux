"use client";

import {
  AlertCircle,
  Beaker,
  BookOpen,
  Boxes,
  Braces,
  Cable,
  Check,
  Copy,
  Gauge,
  Infinity as InfinityIcon,
  KeyRound,
  Link2,
  LoaderCircle,
  ScanEye,
  RefreshCw,
  Server,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ContestantApiAccess } from "@/lib/competition/types";
import { apiRequest } from "./api";
import {
  buildQuickStartExamples,
  type ApiExampleId,
  type ApiProtocol,
} from "./api-examples";
import { ContestantPlayground } from "./ContestantPlayground";

type CopyTarget = "url" | "key" | "quick" | "vision" | null;

const modalityLabels = { text: "文本", image: "图片", video: "视频" } as const;

function modalityText(
  modalities: ContestantApiAccess["models"][number]["inputModalities"],
): string {
  return modalities.map((item) => modalityLabels[item]).join(" · ");
}

function CopyButton({
  target,
  copied,
  onCopy,
  label,
}: {
  target: Exclude<CopyTarget, null>;
  copied: CopyTarget;
  onCopy: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="api-copy-button"
      title={label}
      aria-label={label}
      onClick={onCopy}
    >
      {copied === target ? <Check /> : <Copy />}
    </button>
  );
}

export function ContestantApiDocs() {
  const [access, setAccess] = useState<ContestantApiAccess | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<CopyTarget>(null);
  const [protocol, setProtocol] = useState<ApiProtocol>("openai");
  const [exampleLanguage, setExampleLanguage] = useState<ApiExampleId>("curl");
  const [playgroundOpen, setPlaygroundOpen] = useState(false);

  const loadAccess = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiRequest<{ access: ContestantApiAccess }>(
        "/api/competition/contestant/api-access",
      );
      setAccess(result.access);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "API 调用信息读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    apiRequest<{ access: ContestantApiAccess }>(
      "/api/competition/contestant/api-access",
    )
      .then((result) => { setAccess(result.access); setError(null); })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "API 调用信息读取失败"))
      .finally(() => setLoading(false));
  }, []);

  const primaryModel = access?.models[0]?.id ?? "deepseek-flash";
  const visionModels = useMemo(
    () => access?.models.filter((model) => model.inputModalities.includes("image")) ?? [],
    [access],
  );
  const visionModel = visionModels[0]?.id ?? primaryModel;
  const currentApiBase = access
    ? protocol === "openai" ? access.apiBase : access.anthropicApiBase
    : "";
  const quickStartExamples = useMemo(() => access
    ? buildQuickStartExamples(protocol, {
        apiKey: access.apiKey,
        model: primaryModel,
        openAiBaseUrl: access.apiBase,
        anthropicBaseUrl: access.anthropicApiBase,
      })
    : [], [access, primaryModel, protocol]);
  const activeQuickExample = quickStartExamples.find(
    (example) => example.id === exampleLanguage,
  ) ?? quickStartExamples[0];
  const visionExample = useMemo(() => access ? protocol === "openai" ? `curl ${access.apiBase}/chat/completions \\
  -H "Authorization: Bearer ${access.apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${visionModel}",
    "messages": [{
      "role": "user",
      "content": [
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,BASE64_IMAGE"}},
        {"type": "text", "text": "请分析这张图片"}
      ]
    }]
  }'` : `curl ${access.anthropicApiBase}/v1/messages \\
  -H "x-api-key: ${access.apiKey}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${visionModel}",
    "max_tokens": 1024,
    "messages": [{
      "role": "user",
      "content": [
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "BASE64_IMAGE"}},
        {"type": "text", "text": "请分析这张图片"}
      ]
    }]
  }'` : "", [access, protocol, visionModel]);

  async function copyText(target: Exclude<CopyTarget, null>, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => setCopied(null), 1800);
    } catch {
      setError("复制失败，请手动选择并复制内容");
    }
  }

  const closePlayground = useCallback(() => setPlaygroundOpen(false), []);

  if (loading && !access) {
    return <main className="api-docs-loading"><LoaderCircle className="spinning" /><span>正在读取 API 调用信息</span></main>;
  }

  if (error && !access) {
    return (
      <main className="api-docs-loading error">
        <AlertCircle />
        <strong>{error}</strong>
        <button type="button" className="secondary-action" onClick={() => void loadAccess()}><RefreshCw />重新读取</button>
      </main>
    );
  }

  if (!access) return null;

  const usedPercent = access.requestQuota > 0
    ? Math.min(100, (access.requestsUsed / access.requestQuota) * 100)
    : 100;
  const quotaEnforced = access.quotaEnforced;
  const visibleModels = access.models;
  const hasVisionModels = visionModels.length > 0;
  const visionModelNames = visionModels.map((model) => model.name).join("、");

  return (
    <>
      <main className="contestant-api-docs">
      <header className="api-docs-heading">
        <div>
          <span><BookOpen />API REFERENCE</span>
          <h1>模型 API 技术文档</h1>
          <p>同一把选手 API Key 可通过 OpenAI 兼容接口或 Anthropic Messages 兼容接口，调用竞赛模型白名单内的模型。</p>
        </div>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => void loadAccess()}>
          <RefreshCw className={loading ? "spinning" : ""} />刷新额度
        </button>
      </header>

      {error && <div className="workspace-message error" role="alert">{error}</div>}

      <section className="api-protocol-switcher" aria-label="接口规范">
        <div role="tablist" aria-label="选择接口规范">
          <button
            type="button"
            role="tab"
            aria-selected={protocol === "openai"}
            className={protocol === "openai" ? "active" : ""}
            onClick={() => { setProtocol("openai"); setExampleLanguage("curl"); }}
          >
            <Braces />OpenAI 兼容
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={protocol === "anthropic"}
            className={protocol === "anthropic" ? "active" : ""}
            onClick={() => { setProtocol("anthropic"); setExampleLanguage("curl"); }}
          >
            <Cable />Anthropic 兼容
          </button>
        </div>
        <p>{protocol === "openai"
          ? "适合 OpenAI SDK 和 OpenAI 兼容客户端；可调用模型仅限下方白名单。"
          : "适合 Anthropic SDK 和按 Messages API 开发的客户端；可调用模型仅限下方白名单。"}</p>
      </section>

      <section className="api-access-band" aria-label="API 调用信息">
        <div className="api-credential-field">
          <span><Link2 />API URL</span>
          <div><code>{currentApiBase}</code><CopyButton target="url" copied={copied} label="复制 API URL" onCopy={() => void copyText("url", currentApiBase)} /></div>
        </div>
        <div className="api-credential-field api-key-field">
          <span><KeyRound />API KEY</span>
          <div><code>{access.apiKey}</code><CopyButton target="key" copied={copied} label="复制 API Key" onCopy={() => void copyText("key", access.apiKey)} /></div>
        </div>
        <div className={`api-quota-summary${quotaEnforced ? "" : " unlimited"}`}>
          <span>{quotaEnforced ? <Gauge /> : <InfinityIcon />}REQUEST QUOTA</span>
          <strong>{quotaEnforced ? access.requestsRemaining.toLocaleString("zh-CN") : "不限量"}</strong>
          <small>
            {quotaEnforced
              ? `剩余 / 共 ${access.requestQuota.toLocaleString("zh-CN")} 次`
              : `比赛模式 · 已调用 ${access.requestsUsed.toLocaleString("zh-CN")} 次`}
          </small>
          {quotaEnforced
            ? <div className="quota-track" aria-label={`已使用 ${access.requestsUsed} 次`}><i style={{ width: `${usedPercent}%` }} /></div>
            : <div className="quota-track unlimited" aria-label="比赛模式不限量"><i /></div>}
        </div>
      </section>

      <div className="api-docs-layout">
        <article className="api-reference-content">
          <section className="api-doc-section">
            <header><span>01</span><div><h2>快速调用</h2><p>{protocol === "openai"
              ? <>API URL 已包含 <code>/v1</code>，请勿重复拼接。</>
              : <>API URL 不含版本路径，SDK 会自动请求 <code>/v1/messages</code>。</>}</p></div></header>
            <div className="api-code-sample api-code-tabs">
              <div className="api-code-sample-toolbar">
                <div className="api-code-language-tabs" role="tablist" aria-label="快速调用语言">
                  {quickStartExamples.map((example) => (
                    <button
                      key={example.id}
                      id={`quick-language-${example.id}`}
                      type="button"
                      role="tab"
                      aria-controls="quick-code-panel"
                      aria-selected={activeQuickExample?.id === example.id}
                      className={activeQuickExample?.id === example.id ? "active" : ""}
                      onClick={() => setExampleLanguage(example.id)}
                    >
                      {example.label}
                    </button>
                  ))}
                </div>
                <CopyButton
                  target="quick"
                  copied={copied}
                  label={`复制 ${activeQuickExample?.label ?? ""} 示例`}
                  onCopy={() => void copyText("quick", activeQuickExample?.code ?? "")}
                />
              </div>
              <pre
                id="quick-code-panel"
                role="tabpanel"
                aria-labelledby={`quick-language-${activeQuickExample?.id ?? "curl"}`}
              ><code>{activeQuickExample?.code ?? ""}</code></pre>
            </div>
          </section>

          <section className="api-doc-section">
            <header><span>02</span><div><h2>模型白名单</h2><p>竞赛只开放下表列出的 {visibleModels.length} 个模型 ID；填写其他名称（例如 <code>gpt-4o</code>、<code>claude-sonnet-4</code>）会被拒绝，返回 {protocol === "openai" ? <><code>400 model_not_allowed</code></> : <><code>400 invalid_request_error</code></>}。</p></div></header>
            <div className="api-model-table">
              <div className="api-model-table-head"><span>模型 ID</span><span>模型</span><span>支持输入</span><span>说明</span></div>
              {visibleModels.map((model) => (
                <div key={model.id}>
                  <div className="api-model-id">
                    <code>{model.id}</code>
                    {model.compatibilityAliases.length > 0 && (
                      <small>兼容别名 {model.compatibilityAliases.join("、")}</small>
                    )}
                  </div>
                  <b>{model.name}</b>
                  <span className="api-model-modalities">{modalityText(model.inputModalities)}</span>
                  <span>{model.description}</span>
                </div>
              ))}
            </div>
            <p className="api-stream-hint">模型 ID 大小写不敏感。{protocol === "openai"
              ? <>调用 <code>GET /models</code> 可随时获取同一份白名单。</>
              : <>Anthropic 兼容入口只兼容 Messages 请求格式，不提供 Claude 模型，<code>model</code> 字段同样只能填写上表中的 ID。</>}</p>
          </section>

          <section className="api-doc-section">
            <header><span>03</span><div><h2>接口地址</h2><p>{protocol === "openai"
              ? <>请求在 HTTP Header 中携带 <code>Authorization: Bearer API_KEY</code>。</>
              : <>请求携带 <code>x-api-key: API_KEY</code> 和 <code>anthropic-version: 2023-06-01</code>。</>}</p></div></header>
            <div className="endpoint-list">
              {protocol === "openai" ? <>
                <div><b className="http-method get">GET</b><code>/models</code><span>查询当前允许调用的模型</span></div>
                <div><b className="http-method post">POST</b><code>/chat/completions</code><span>创建对话补全，支持 <code>stream: true</code></span></div>
              </> : <>
                <div><b className="http-method post">POST</b><code>/v1/messages</code><span>创建消息，支持文本、图片、工具调用与 <code>stream: true</code></span></div>
              </>}
            </div>
            {protocol === "anthropic" && <p className="api-stream-hint">设置 <code>stream: true</code> 后返回 Anthropic Messages SSE 事件，包括 <code>message_start</code>、内容增量和 <code>message_stop</code>。</p>}
          </section>

          {hasVisionModels && (
          <section className="api-doc-section">
            <header><span>04</span><div><h2>多模态输入</h2><p>{protocol === "openai"
              ? `白名单中只有 ${visionModelNames} 支持图片与视频理解，输出仍为文本。`
              : `Anthropic Messages 兼容入口可向白名单中的 ${visionModelNames} 传入图片，输出仍为文本。`}</p></div></header>
            <div className="api-multimodal-note"><ScanEye /><p><strong>多模态理解，不是图片生成</strong><span>{protocol === "openai"
              ? "使用 image_url / video_url 内容项；图片可传公网 URL 或 Base64 Data URL。"
              : `使用 image / source 内容块；Anthropic 兼容入口的图片调用请选择 ${visionModelNames}，视频请使用 OpenAI 接口。`}</span></p></div>
            <div className="api-code-sample">
              <div><span><Terminal />{protocol === "openai" ? "OpenAI" : "Anthropic"} · 图片理解</span><CopyButton target="vision" copied={copied} label="复制图片理解示例" onCopy={() => void copyText("vision", visionExample)} /></div>
              <pre><code>{visionExample}</code></pre>
            </div>
            <button type="button" className="api-playground-link" onClick={() => setPlaygroundOpen(true)}><Beaker />在 Playground 中测试</button>
          </section>
          )}

          <section className="api-doc-section">
            <header><span>{hasVisionModels ? "05" : "04"}</span><div><h2>错误码</h2><p>{quotaEnforced ? "失败请求不会扣减总请求额度。" : "比赛模式不限总额度，失败请求也不会计入调用次数。"}</p></div></header>
            <div className="api-error-table">
              {protocol === "openai" ? <>
                <div><code>invalid_api_key</code><span>API Key 缺失、错误或账号已停用</span><b>401</b></div>
                <div><code>model_not_allowed</code><span>模型不在竞赛允许列表中</span><b>400</b></div>
                <div><code>rate_limit_exceeded</code><span>超过每分钟请求频率</span><b>429</b></div>
                <div><code>quota_exceeded</code><span>{quotaEnforced ? "账号总请求额度已用完" : "比赛模式下不会出现"}</span><b>429</b></div>
                <div><code>service_suspended</code><span>管理员已暂停模型服务</span><b>503</b></div>
              </> : <>
                <div><code>authentication_error</code><span>API Key 缺失、错误或账号已停用</span><b>401</b></div>
                <div><code>invalid_request_error</code><span>参数、模型或请求体不符合要求</span><b>400</b></div>
                <div><code>rate_limit_error</code><span>超过每分钟频率或总请求额度</span><b>429</b></div>
                <div><code>api_error</code><span>模型服务暂停、超时或上游暂不可用</span><b>5xx</b></div>
              </>}
            </div>
          </section>
        </article>

        <aside className="api-docs-sidebar">
          <section>
            <span className="api-sidebar-label"><Server />调用限制</span>
            <dl>
              <div><dt>每分钟频率</dt><dd>{access.rateLimitRpm} 次</dd></div>
              <div><dt>已调用</dt><dd>{access.requestsUsed.toLocaleString("zh-CN")} 次</dd></div>
              <div><dt>剩余额度</dt><dd>{quotaEnforced ? `${access.requestsRemaining.toLocaleString("zh-CN")} 次` : "不限量"}</dd></div>
            </dl>
          </section>
          <section>
            <span className="api-sidebar-label"><Cable />规范与凭证</span>
            <p className="api-protocol-scope">两套接口共用当前 API Key、每分钟频率、总请求额度和同一份模型白名单。{quotaEnforced ? "" : "比赛模式解除的只是总额度，每分钟频率限制依然有效。"}Anthropic Messages 兼容仅表示请求与响应格式兼容，不代表提供 Claude 模型。</p>
          </section>
          <section>
            <span className="api-sidebar-label"><Boxes />模型白名单 · {visibleModels.length}</span>
            <div className="api-model-chips">
              {visibleModels.map((model) => (
                <code key={model.id}>{model.id}</code>
              ))}
            </div>
            <p className="api-protocol-scope">白名单之外的模型 ID 一律以 400 拒绝，两套接口共用这一份列表，完整说明见“模型白名单”一节。</p>
          </section>
          <div className="api-security-note"><KeyRound /><p><strong>凭证仅限本人使用</strong><span>不要将 API Key 写入公开代码仓库或发给其他选手。</span></p></div>
        </aside>
      </div>
      </main>
      {playgroundOpen && (
        <ContestantPlayground
          access={access}
          onClose={closePlayground}
          onRequestComplete={loadAccess}
        />
      )}
    </>
  );
}
