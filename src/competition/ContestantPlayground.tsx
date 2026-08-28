"use client";

import {
  AlertCircle,
  Beaker,
  Braces,
  ImagePlus,
  LoaderCircle,
  Play,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  buildPlaygroundApiCall,
  playgroundRequestSchema,
} from "@/lib/competition/playground";
import type { ContestantApiAccess } from "@/lib/competition/types";

interface PlaygroundCompletion {
  model?: string;
  choices?: Array<{
    message?: {
      content?: unknown;
      reasoning_content?: unknown;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: string | { code?: string; message?: string };
}

interface PlaygroundResult {
  payload: PlaygroundCompletion;
  provider: string | null;
  durationMs: number;
}

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function responseText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const text = (item as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function responseError(payload: PlaygroundCompletion, status: number): string {
  if (typeof payload.error === "string") return payload.error;
  if (payload.error?.message) return payload.error.message;
  return `模型调用失败（HTTP ${status}）`;
}

function fileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error("图片读取失败"));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

export function ContestantPlayground({
  access,
  onClose,
}: {
  access: ContestantApiAccess;
  onClose: () => void;
}) {
  const [model, setModel] = useState(access.models[0]?.id ?? "");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [prompt, setPrompt] = useState("");
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [remoteImageUrl, setRemoteImageUrl] = useState("");
  const [enableThinking, setEnableThinking] = useState(false);
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const requestControllerRef = useRef<AbortController>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      requestControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !running) onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, running]);

  const selectedModel = useMemo(
    () => access.models.find((item) => item.id === model) ?? null,
    [access.models, model],
  );
  const supportsImage = selectedModel?.inputModalities.includes("image") ?? false;
  const supportsThinkingToggle = selectedModel?.family === "deepseek" ||
    selectedModel?.family === "qwen";
  const supportsTemperatureControl = ![
    "glm",
    "kimi",
    "minimax",
    "doubao",
  ].includes(selectedModel?.family ?? "custom");
  const answer = responseText(result?.payload.choices?.[0]?.message?.content);
  const reasoning = responseText(result?.payload.choices?.[0]?.message?.reasoning_content);

  function changeModel(nextModel: string) {
    setModel(nextModel);
    const next = access.models.find((item) => item.id === nextModel);
    if (!next?.inputModalities.includes("image")) {
      setImage(null);
      setRemoteImageUrl("");
    }
    if (next?.family !== "deepseek" && next?.family !== "qwen") {
      setEnableThinking(false);
    }
  }

  async function chooseImage(file: File | undefined) {
    if (!file) return;
    setError(null);
    if (!acceptedImageTypes.has(file.type)) {
      setError("仅支持 PNG、JPG 或 WebP 图片");
      return;
    }
    try {
      setImage({ name: file.name, dataUrl: await fileDataUrl(file) });
      setRemoteImageUrl("");
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "图片读取失败");
    }
  }

  async function runPlayground() {
    if (!model || !prompt.trim() || running) return;
    const parsed = playgroundRequestSchema.safeParse({
      model,
      family: selectedModel?.family ?? "custom",
      supportsImage,
      systemPrompt,
      prompt,
      imageUrl: image?.dataUrl ?? (remoteImageUrl.trim() || null),
      enableThinking,
      temperature,
      maxTokens,
    });
    if (!parsed.success) {
      setError("请检查输入内容、图片地址和生成参数");
      return;
    }
    setRunning(true);
    setError(null);
    setResult(null);
    const startedAt = performance.now();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const call = buildPlaygroundApiCall(access.apiBase, access.apiKey, parsed.data);
      const response = await fetch(call.path, { ...call.init, signal: controller.signal });
      const payload = await response.json().catch(() => ({})) as PlaygroundCompletion;
      if (!response.ok) throw new Error(responseError(payload, response.status));
      setResult({
        payload,
        provider: response.headers.get("X-ModelMux-Provider"),
        durationMs: Math.round(performance.now() - startedAt),
      });
    } catch (runError) {
      if (runError instanceof Error && runError.name === "AbortError") return;
      setError(runError instanceof Error ? runError.message : "模型调用失败");
    } finally {
      if (requestControllerRef.current === controller) {
        requestControllerRef.current = null;
      }
      setRunning(false);
    }
  }

  return (
    <div
      className="playground-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !running) onClose();
      }}
    >
      <section
        className="playground-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="playground-dialog-title"
      >
      <header className="playground-modal-heading">
        <div>
          <span><Beaker />API PLAYGROUND</span>
          <h2 id="playground-dialog-title">模型调用测试</h2>
        </div>
        <div className="playground-modal-actions">
          <button ref={closeButtonRef} type="button" className="playground-modal-close" title="关闭" aria-label="关闭 Playground" disabled={running} onClick={onClose}><X /></button>
        </div>
      </header>

      <div className="playground-modal-content">
      {error && <div className="workspace-message error" role="alert"><AlertCircle />{error}</div>}

      <div className="playground-layout">
        <section className="playground-panel playground-request-panel">
          <header>
            <div><span>REQUEST</span><h2>输入</h2></div>
            <button
              type="button"
              className="playground-icon-button"
              title="重置输入"
              aria-label="重置输入"
              onClick={() => {
                setSystemPrompt("");
                setPrompt("");
                setImage(null);
                setRemoteImageUrl("");
                setEnableThinking(false);
                setTemperature(0.7);
                setMaxTokens(1024);
                setResult(null);
                setError(null);
              }}
            ><RotateCcw /></button>
          </header>

          <div className="playground-form">
            <label className="playground-field">
              <span>模型</span>
              <select value={model} onChange={(event) => changeModel(event.target.value)}>
                {access.models.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.id}</option>
                ))}
              </select>
              {selectedModel && (
                <small>
                  {selectedModel.inputModalities.map((item) => item === "text" ? "文本" : item === "image" ? "图片" : "视频").join(" / ")}
                </small>
              )}
            </label>

            <label className="playground-field">
              <span>系统提示词 <small>可选</small></span>
              <textarea rows={3} maxLength={2000} value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} placeholder="你是一个严谨、简洁的助手。" />
            </label>

            <label className="playground-field playground-prompt-field">
              <span>用户输入</span>
              <textarea rows={8} maxLength={8000} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入要发送给模型的内容" />
              <small>{prompt.length.toLocaleString("zh-CN")} / 8,000</small>
            </label>

            <div className={`playground-image-field ${supportsImage ? "" : "disabled"}`}>
              <div><span>图片输入</span><small>{supportsImage ? "PNG / JPG / WebP" : "当前模型仅支持文本"}</small></div>
              <label className="playground-image-url">
                <span>HTTPS URL</span>
                <input
                  type="url"
                  disabled={!supportsImage}
                  value={remoteImageUrl}
                  placeholder="https://example.com/image.png"
                  onChange={(event) => {
                    setRemoteImageUrl(event.target.value);
                    if (event.target.value) setImage(null);
                  }}
                />
              </label>
              <div className="playground-image-divider"><span>或上传本地图片</span></div>
              {image ? (
                <div className="playground-image-preview">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.dataUrl} alt="待识别图片预览" />
                  <span title={image.name}>{image.name}</span>
                  <button type="button" title="移除图片" aria-label="移除图片" onClick={() => setImage(null)}><Trash2 /></button>
                </div>
              ) : (
                <button type="button" className="playground-upload-button" disabled={!supportsImage} onClick={() => fileInputRef.current?.click()}><ImagePlus />添加图片</button>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  event.currentTarget.value = "";
                  void chooseImage(file);
                }}
              />
            </div>

            <div className="playground-settings">
              {supportsThinkingToggle && (
                <label className="playground-toggle">
                  <input type="checkbox" checked={enableThinking} onChange={(event) => setEnableThinking(event.target.checked)} />
                  <span aria-hidden="true" />
                  深度思考
                </label>
              )}
              {supportsTemperatureControl && (
                <label className="playground-range">
                  <span>温度 <output>{temperature.toFixed(1)}</output></span>
                  <input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
                </label>
              )}
              <label className="playground-token-input">
                <span>最大输出</span>
                <input type="number" min="128" max="4096" step="128" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} />
              </label>
            </div>
          </div>

          <footer>
            <button type="button" className="playground-run-button" disabled={running || !model || !prompt.trim()} onClick={() => void runPlayground()}>
              {running ? <LoaderCircle className="spinning" /> : <Play />}
              {running ? "调用中" : "运行"}
            </button>
          </footer>
        </section>

        <section className="playground-panel playground-response-panel" aria-live="polite">
          <header>
            <div><span>RESPONSE</span><h2>返回</h2></div>
            {result && (
              <button type="button" className="playground-icon-button" title="清空返回" aria-label="清空返回" onClick={() => setResult(null)}><Trash2 /></button>
            )}
          </header>

          {running ? (
            <div className="playground-response-empty"><LoaderCircle className="spinning" /><strong>模型正在处理</strong></div>
          ) : result ? (
            <div className="playground-response-content">
              <div className="playground-response-meta">
                <span>{result.payload.model ?? model}</span>
                {result.provider && <span>{result.provider}</span>}
                <span>{result.durationMs.toLocaleString("zh-CN")} ms</span>
                {typeof result.payload.usage?.total_tokens === "number" && <span>{result.payload.usage.total_tokens.toLocaleString("zh-CN")} tokens</span>}
              </div>
              {reasoning && (
                <details className="playground-reasoning">
                  <summary>思考内容</summary>
                  <pre>{reasoning}</pre>
                </details>
              )}
              <div className="playground-answer"><pre>{answer || "模型未返回文本内容"}</pre></div>
              <details className="playground-raw-response">
                <summary><Braces />原始 JSON</summary>
                <pre>{JSON.stringify(result.payload, null, 2)}</pre>
              </details>
            </div>
          ) : (
            <div className="playground-response-empty"><Braces /><strong>等待调用</strong></div>
          )}
        </section>
      </div>
      </div>
      </section>
    </div>
  );
}
