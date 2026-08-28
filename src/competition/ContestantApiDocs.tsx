"use client";

import {
  AlertCircle,
  Beaker,
  BookOpen,
  Boxes,
  Braces,
  Check,
  CircleHelp,
  Copy,
  KeyRound,
  Link2,
  LoaderCircle,
  ScanEye,
  RefreshCw,
  Terminal,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ContestantApiAccess } from "@/lib/competition/types";
import { apiRequest } from "./api";
import {
  buildQuickStartExamples,
  type ApiExampleId,
} from "./api-examples";
import { ContestantPlayground } from "./ContestantPlayground";

type CopyTarget =
  | "url"
  | "key"
  | "quick"
  | "vision"
  | `model:${string}`
  | null;

const modalityLabels = {
  text: "文本",
  image: "图片",
  video: "视频",
} as const;

function modalityText(
  modalities: ContestantApiAccess["models"][number]["inputModalities"],
): string {
  return modalities.map((item) => modalityLabels[item]).join(" · ");
}

function modelCopyTarget(modelId: string): `model:${string}` {
  return `model:${modelId}`;
}

function contextWindowText(
  tokens: number | null,
): string {
  if (tokens === null) return "平台为准";
  if (tokens >= 1_000_000) return "1M tokens";
  if (tokens % 1_024 === 0) return `${tokens / 1_024}K tokens`;
  return `${tokens.toLocaleString("zh-CN")} tokens`;
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

  const primaryModel = access?.models[0]?.id ?? "deepseek-v4-flash";
  const visionModels = useMemo(
    () => access?.models.filter((model) => model.inputModalities.includes("image")) ?? [],
    [access],
  );
  const visionModel = visionModels[0]?.id ?? primaryModel;
  const currentApiBase = access?.apiBase ?? "";
  const quickStartExamples = useMemo(() => access
    ? buildQuickStartExamples({
        apiKey: access.apiKey,
        model: primaryModel,
        openAiBaseUrl: access.apiBase,
      })
    : [], [access, primaryModel]);
  const activeQuickExample = quickStartExamples.find(
    (example) => example.id === exampleLanguage,
  ) ?? quickStartExamples[0];
  const visionExample = useMemo(() => access ? `curl ${access.apiBase}/chat/completions \\
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
  }'` : "", [access, visionModel]);
  async function copyText(target: Exclude<CopyTarget, null>, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(target);
      window.setTimeout(() => {
        setCopied((current) => current === target ? null : current);
      }, 1800);
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
          <p>使用选手 API Key 通过 OpenAI 兼容接口调用竞赛模型白名单内的模型。</p>
        </div>
        <button type="button" className="secondary-action" disabled={loading} onClick={() => void loadAccess()}>
          <RefreshCw className={loading ? "spinning" : ""} />刷新信息
        </button>
      </header>

      {error && <div className="workspace-message error" role="alert">{error}</div>}

      <section className="api-access-band" aria-label="API 调用信息">
        <div className="api-credential-field">
          <span><Link2 />API URL</span>
          <div><code>{currentApiBase}</code><CopyButton target="url" copied={copied} label="复制 API URL" onCopy={() => void copyText("url", currentApiBase)} /></div>
        </div>
        <div className="api-credential-field api-key-field">
          <span><KeyRound />API KEY</span>
          <div><code>{access.apiKey}</code><CopyButton target="key" copied={copied} label="复制 API Key" onCopy={() => void copyText("key", access.apiKey)} /></div>
        </div>
        <div className="api-access-models" aria-label={`可用模型，共 ${visibleModels.length} 个`}>
          <div className="api-access-models-heading">
            <span><Boxes />可用模型</span>
            <a
              className="api-model-help-link"
              href="#model-access-help"
              onClick={(event) => {
                event.preventDefault();
                document.getElementById("model-access-help")?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                });
              }}
            >
              想用的模型不在列表中？查看说明
            </a>
          </div>
          <div className="api-model-specs-wrap">
            <table className="api-model-specs">
              <thead>
                <tr>
                  <th scope="col">模型 ID</th>
                  <th scope="col">模型名称</th>
                  <th scope="col">支持输入</th>
                  <th scope="col">上下文窗口</th>
                  <th scope="col">说明</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {visibleModels.map((model) => (
                  <tr key={model.id}>
                    <td><code>{model.id}</code></td>
                    <td><strong title={model.description}>{model.name}</strong></td>
                    <td><span className="api-model-modalities">{modalityText(model.inputModalities)}</span></td>
                    <td title={model.contextWindowTokens === null
                      ? undefined
                      : `${model.contextWindowTokens.toLocaleString("zh-CN")} tokens`}
                    >{contextWindowText(model.contextWindowTokens)}</td>
                    <td>{model.description}</td>
                    <td>
                      <CopyButton
                        target={modelCopyTarget(model.id)}
                        copied={copied}
                        label={`复制模型 ID ${model.id}`}
                        onCopy={() => void copyText(modelCopyTarget(model.id), model.id)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <div className="api-docs-layout">
        <article className="api-reference-content">
          <section className="api-doc-section">
            <header><span>01</span><div><h2>快速调用</h2><p>API URL 已包含 <code>/v1</code>，请勿重复拼接。</p></div></header>
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
            <header><span>02</span><div><h2>接口地址</h2><p>请求在 HTTP Header 中携带 <code>Authorization: Bearer API_KEY</code>。</p></div></header>
            <div className="endpoint-list">
              <div><b className="http-method get">GET</b><code>/models</code><span>查询当前允许调用的模型</span></div>
              <div><b className="http-method post">POST</b><code>/chat/completions</code><span>创建对话补全，支持 <code>stream: true</code></span></div>
            </div>
          </section>

          {hasVisionModels && (
          <section className="api-doc-section">
            <header><span>03</span><div><h2>多模态输入</h2><p>白名单中只有 {visionModelNames} 支持图片与视频理解，输出仍为文本。</p></div></header>
            <div className="api-multimodal-note"><ScanEye /><p><strong>多模态理解，不是图片生成</strong><span>使用 image_url / video_url 内容项；图片可传公网 URL 或 Base64 Data URL。</span></p></div>
            <div className="api-code-sample">
              <div><span><Terminal />OpenAI · 图片理解</span><CopyButton target="vision" copied={copied} label="复制图片理解示例" onCopy={() => void copyText("vision", visionExample)} /></div>
              <pre><code>{visionExample}</code></pre>
            </div>
            <button type="button" className="api-playground-link" onClick={() => setPlaygroundOpen(true)}><Beaker />在 Playground 中测试</button>
          </section>
          )}

          <section className="api-doc-section">
            <header><span>{hasVisionModels ? "04" : "03"}</span><div><h2>错误码</h2><p>上游响应由网关原样返回。</p></div></header>
            <div className="api-error-table">
              <div><code>invalid_api_key</code><span>API Key 缺失、错误或账号已停用</span><b>401</b></div>
              <div><code>model_not_allowed</code><span>模型不在竞赛允许列表中</span><b>400</b></div>
              <div><code>service_suspended</code><span>管理员已暂停模型服务</span><b>503</b></div>
            </div>
          </section>
        </article>

        <aside className="api-docs-sidebar">
          <section>
            <span className="api-sidebar-label"><Braces />规范与凭证</span>
            <p className="api-protocol-scope">模型 API 统一使用 OpenAI Chat Completions 兼容规范和 Bearer 凭证。</p>
          </section>
          <div className="api-security-note"><KeyRound /><p><strong>凭证仅限本人使用</strong><span>不要将 API Key 写入公开代码仓库或发给其他选手。</span></p></div>
        </aside>
      </div>
      <section className="api-model-access-help" id="model-access-help">
        <CircleHelp />
        <div>
          <h2>列表外模型申请</h2>
          <p>如需使用当前列表之外的模型，请联系赛事方并提供模型名称和使用需求，由赛事方统一评估、配置和开放。</p>
        </div>
      </section>
      </main>
      {playgroundOpen && (
        <ContestantPlayground
          access={access}
          onClose={closePlayground}
        />
      )}
    </>
  );
}
