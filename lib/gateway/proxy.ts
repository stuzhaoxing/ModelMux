import { randomUUID } from "node:crypto";

import {
  convertAnthropicRequest,
  convertOpenAIResponseToAnthropic,
} from "./anthropic";
import { loadGatewayConfig, providerKeys } from "./config";
import { errorResponse, optionsResponse, withCors } from "./http";
import {
  consumeRateLimit,
  nextProviderKey,
  recordRequest,
} from "./runtime";
import {
  authenticateClient,
  clientAuthConfigured,
  type ClientIdentity,
} from "./security";
import { operationModeState, quotaEnforced } from "./operation-mode";
import { gatewayServiceState } from "./service-state";
import { recordActivity } from "../competition/activity";
import { modelCallDetail, outcomeForStatus } from "../competition/activity-log";
import {
  releaseContestantApiRequest,
  reserveContestantApiRequest,
} from "../competition/repository";
import type {
  GatewayConfig,
  ModelRouteGroup,
  ProviderAdapter,
  ProviderRoute,
} from "./types";

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const DECODED_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
]);

interface PreparedRequest {
  payload: Record<string, unknown>;
  model: ModelRouteGroup;
}

type RequestPreparer = (
  request: Request,
  config: GatewayConfig,
) => Promise<PreparedRequest | Response>;

async function readLimitedBody(
  request: Request,
  maxBodyBytes: number,
): Promise<Uint8Array | Response> {
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBodyBytes) {
      await reader.cancel("request body exceeds limit");
      return errorResponse(
        413,
        "request_too_large",
        `请求体超过 ${maxBodyBytes} 字节限制。`,
      );
    }
    chunks.push(value);
  }

  const body = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function requestHeaders(request: Request, providerKey: string): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      lower === "authorization" ||
      lower === "x-api-key" ||
      lower === "anthropic-version" ||
      lower === "anthropic-beta"
    ) return;
    headers.set(name, value);
  });
  headers.set("Authorization", `Bearer ${providerKey}`);
  headers.set("Accept-Encoding", "identity");
  headers.set("Content-Type", "application/json");
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (!HOP_BY_HOP_HEADERS.has(lower) && !DECODED_RESPONSE_HEADERS.has(lower)) {
      headers.set(name, value);
    }
  });
  headers.set("Cache-Control", "no-store");
  headers.set("X-Accel-Buffering", "no");
  return headers;
}

function resolveModel(
  requested: unknown,
  config: GatewayConfig,
): ModelRouteGroup | null {
  if (typeof requested !== "string") return null;
  const normalized = requested.trim().toLowerCase();
  return (
    config.models.find(
      (model) =>
        model.alias.toLowerCase() === normalized ||
        model.compatibilityAliases.some((alias) => alias === normalized),
    ) ?? null
  );
}

function providerAdapter(route: ProviderRoute): ProviderAdapter {
  if (route.adapter) return route.adapter;
  const provider = route.provider.toLowerCase();
  if (provider === "deepseek") return "deepseek";
  if (provider === "aliyun" || provider === "dashscope") return "dashscope";
  if (provider === "siliconflow") return "siliconflow";
  return "openai";
}

function providerPayload(
  payload: Record<string, unknown>,
  model: ModelRouteGroup,
  route: ProviderRoute,
): Record<string, unknown> {
  const adapted: Record<string, unknown> = {
    ...payload,
    model: route.upstreamModel,
  };
  const adapter = providerAdapter(route);

  if (model.family === "deepseek") {
    delete adapted.enable_thinking;
    delete adapted.thinking_budget;
    if (adapter === "siliconflow") {
      const thinking = adapted.thinking as { type?: unknown } | undefined;
      delete adapted.thinking;
      delete adapted.reasoning_effort;
      adapted.enable_thinking = thinking?.type !== "disabled";
    }
  } else if (model.family === "qwen") {
    delete adapted.thinking;
    delete adapted.reasoning_effort;
  }

  return adapted;
}

function validateOfficialModelParameters(
  payload: Record<string, unknown>,
  model: ModelRouteGroup,
): Response | null {
  if (model.family === "deepseek") {
    if (payload.enable_thinking !== undefined || payload.thinking_budget !== undefined) {
      return errorResponse(
        400,
        "invalid_model_parameter",
        "DeepSeek V4 请使用官方参数 thinking 和 reasoning_effort。",
      );
    }
    if (payload.thinking !== undefined) {
      const thinking = payload.thinking;
      if (
        !thinking ||
        typeof thinking !== "object" ||
        Array.isArray(thinking) ||
        !["enabled", "disabled"].includes(
          String((thinking as Record<string, unknown>).type),
        )
      ) {
        return errorResponse(
          400,
          "invalid_model_parameter",
          "DeepSeek thinking.type 只能是 enabled 或 disabled。",
        );
      }
    }
    if (
      payload.reasoning_effort !== undefined &&
      payload.reasoning_effort !== "high" &&
      payload.reasoning_effort !== "max"
    ) {
      return errorResponse(
        400,
        "invalid_model_parameter",
        "DeepSeek reasoning_effort 只能是 high 或 max。",
      );
    }
  }

  if (model.family === "qwen") {
    if (payload.thinking !== undefined || payload.reasoning_effort !== undefined) {
      return errorResponse(
        400,
        "invalid_model_parameter",
        "Qwen Chat Completions 请使用官方参数 enable_thinking 和 thinking_budget。",
      );
    }
    if (
      payload.enable_thinking !== undefined &&
      typeof payload.enable_thinking !== "boolean"
    ) {
      return errorResponse(
        400,
        "invalid_model_parameter",
        "Qwen enable_thinking 必须是布尔值。",
      );
    }
    if (
      payload.thinking_budget !== undefined &&
      (!Number.isSafeInteger(payload.thinking_budget) ||
        Number(payload.thinking_budget) <= 0)
    ) {
      return errorResponse(
        400,
        "invalid_model_parameter",
        "Qwen thinking_budget 必须是正整数。",
      );
    }
  }

  return null;
}

function preparePayload(
  payload: Record<string, unknown>,
  config: GatewayConfig,
): PreparedRequest | Response {
  const model = resolveModel(payload.model, config);
  if (!model) {
    return errorResponse(
      400,
      "model_not_allowed",
      `不支持模型 '${String(payload.model ?? "")}'，请使用 ${config.models.map((item) => item.alias).join(" 或 ")}。`,
    );
  }

  const parameterError = validateOfficialModelParameters(payload, model);
  if (parameterError) return parameterError;

  return { payload, model };
}

async function readJsonPayload(
  request: Request,
  config: GatewayConfig,
): Promise<Record<string, unknown> | Response> {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "0",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > config.maxBodyBytes) {
    return errorResponse(
      413,
      "request_too_large",
      `请求体超过 ${config.maxBodyBytes} 字节限制。`,
    );
  }

  const body = await readLimitedBody(request, config.maxBodyBytes);
  if (body instanceof Response) return body;

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  } catch {
    return errorResponse(400, "invalid_json", "请求体必须是有效的 JSON 对象。");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(400, "invalid_json", "请求体必须是有效的 JSON 对象。");
  }

  return payload;
}

async function prepareRequest(
  request: Request,
  config: GatewayConfig,
): Promise<PreparedRequest | Response> {
  const payload = await readJsonPayload(request, config);
  return payload instanceof Response ? payload : preparePayload(payload, config);
}

function availableAttempts(
  model: ModelRouteGroup,
): Array<{ route: ProviderRoute; key: string }> {
  const attempts: Array<{ route: ProviderRoute; key: string }> = [];
  for (const route of model.routes) {
    const keys = providerKeys(route);
    if (keys.length === 0) continue;
    const poolId = `${route.provider}:${route.apiKeyEnv}`;
    const firstKey = nextProviderKey(poolId, keys);
    const firstIndex = keys.indexOf(firstKey);
    for (let offset = 0; offset < keys.length; offset += 1) {
      attempts.push({
        route,
        key: keys[(firstIndex + offset) % keys.length],
      });
    }
  }
  return attempts;
}

function shouldRetry(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

async function logContestantCall(
  client: ClientIdentity,
  call: {
    model: string;
    durationMs: number;
    errorCode: string | null;
    remaining: number | null;
    outcome: "ok" | "warn" | "error";
  },
): Promise<void> {
  if (client.contestantId === null) return;
  await recordActivity({
    category: "model",
    action: call.errorCode ? "model-rejected" : "model-call",
    actorRole: "contestant",
    actorId: client.contestantId,
    actorUsername: client.label,
    actorName: client.contestantName ?? client.label,
    questionId: null,
    questionTitle: null,
    detail: modelCallDetail(call),
    outcome: call.outcome,
  });
}

async function proxyChatCompletionsForClient(
  request: Request,
  providedClient?: ClientIdentity,
  prepare: RequestPreparer = prepareRequest,
): Promise<Response> {
  const config = loadGatewayConfig();
  if (request.method === "OPTIONS") return optionsResponse(request, config);
  const [serviceState, modeState] = await Promise.all([
    gatewayServiceState(),
    operationModeState(),
  ]);
  if (!serviceState.enabled) {
    return withCors(
      errorResponse(
        503,
        "service_suspended",
        "模型服务已由管理员停止。",
        { "Retry-After": "3600" },
      ),
      request,
      config,
    );
  }

  if (!providedClient && !clientAuthConfigured(config)) {
    return withCors(
      errorResponse(
        503,
        "client_auth_not_configured",
        "网关尚未配置选手访问密钥。",
      ),
      request,
      config,
    );
  }

  const client = providedClient ?? await authenticateClient(request, config);
  if (!client) {
    return withCors(
      errorResponse(401, "invalid_api_key", "缺少或无效的选手 API Key。", {
        "WWW-Authenticate": "Bearer",
      }),
      request,
      config,
    );
  }

  const rateLimit = consumeRateLimit(client.id, config.rateLimitRpm);
  if (!rateLimit.allowed) {
    const retryAfter = Math.max(
      1,
      Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
    );
    return withCors(
      errorResponse(429, "rate_limit_exceeded", "请求频率超过当前分钟限额。", {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Remaining": "0",
      }),
      request,
      config,
    );
  }

  const prepared = await prepare(request, config);
  if (prepared instanceof Response) return withCors(prepared, request, config);

  const attempts = availableAttempts(prepared.model);
  if (attempts.length === 0) {
    return withCors(
      errorResponse(
        503,
        "provider_not_configured",
        `模型 '${prepared.model.alias}' 尚未配置可用供应商密钥。`,
      ),
      request,
      config,
    );
  }

  const enforceQuota = quotaEnforced(modeState.mode);
  const quota = client.contestantId === null
    ? null
    : await reserveContestantApiRequest(client.contestantId, enforceQuota);
  if (quota && !quota.allowed) {
    void logContestantCall(client, {
      model: prepared.model.alias,
      durationMs: 0,
      errorCode: "quota_exceeded",
      remaining: 0,
      outcome: "warn",
    });
    return withCors(
      errorResponse(429, "quota_exceeded", "本账号的模型 API 请求额度已用完。", {
        "X-Quota-Remaining": "0",
        "X-ModelMux-Mode": modeState.mode,
      }),
      request,
      config,
    );
  }

  const requestId = randomUUID();
  const beganAt = Date.now();
  let lastStatus = 502;
  let lastErrorCode = "upstream_unreachable";

  for (let index = 0; index < attempts.length; index += 1) {
    const { route, key } = attempts[index];
    try {
      const upstream = await fetch(`${route.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: requestHeaders(request, key),
        body: JSON.stringify(
          providerPayload(prepared.payload, prepared.model, route),
        ),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(config.requestTimeoutMs),
      });
      lastStatus = upstream.status;
      lastErrorCode = upstream.status === 429 ? "upstream_rate_limited" : "upstream_error";

      if (shouldRetry(upstream.status) && index < attempts.length - 1) {
        await upstream.body?.cancel();
        continue;
      }

      recordRequest({
        id: requestId,
        timestamp: Date.now(),
        model: prepared.model.alias,
        provider: route.provider,
        upstreamModel: route.upstreamModel,
        status: upstream.status,
        durationMs: Date.now() - beganAt,
        attempts: index + 1,
        client: client.label,
        errorCode: upstream.ok ? null : lastErrorCode,
      });

      let quotaRemaining = quota?.remaining ?? null;
      if (!upstream.ok && client.contestantId !== null) {
        await releaseContestantApiRequest(client.contestantId);
        if (quotaRemaining !== null) quotaRemaining += 1;
      }
      void logContestantCall(client, {
        model: prepared.model.alias,
        durationMs: Date.now() - beganAt,
        errorCode: upstream.ok ? null : lastErrorCode,
        remaining: quotaRemaining,
        outcome: outcomeForStatus(upstream.status),
      });

      const headers = responseHeaders(upstream);
      headers.set("X-ModelMux-Request-Id", requestId);
      headers.set("X-ModelMux-Provider", route.provider);
      headers.set("X-RateLimit-Remaining", String(rateLimit.remaining));
      headers.set("X-ModelMux-Mode", modeState.mode);
      if (quotaRemaining !== null) {
        headers.set("X-Quota-Remaining", String(quotaRemaining));
      }
      return withCors(
        new Response(upstream.body, { status: upstream.status, headers }),
        request,
        config,
      );
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError");
      lastStatus = timedOut ? 504 : 502;
      lastErrorCode = lastStatus === 504 ? "upstream_timeout" : "upstream_unreachable";
      if (index < attempts.length - 1) continue;
    }
  }

  recordRequest({
    id: requestId,
    timestamp: Date.now(),
    model: prepared.model.alias,
    provider: null,
    upstreamModel: null,
    status: lastStatus,
    durationMs: Date.now() - beganAt,
    attempts: attempts.length,
    client: client.label,
    errorCode: lastErrorCode,
  });

  if (client.contestantId !== null) {
    await releaseContestantApiRequest(client.contestantId);
  }
  const releasedRemaining = quota?.remaining === null || quota === null
    ? null
    : quota.remaining + 1;
  void logContestantCall(client, {
    model: prepared.model.alias,
    durationMs: Date.now() - beganAt,
    errorCode: lastErrorCode,
    remaining: releasedRemaining,
    outcome: "error",
  });

  return withCors(
    errorResponse(
      lastStatus,
      lastErrorCode,
      lastStatus === 504 ? "上游模型响应超时。" : "无法连接上游模型服务。",
      {
        "X-ModelMux-Request-Id": requestId,
        "X-ModelMux-Mode": modeState.mode,
        ...(releasedRemaining === null
          ? {}
          : { "X-Quota-Remaining": String(releasedRemaining) }),
      },
    ),
    request,
    config,
  );
}

export async function proxyChatCompletions(request: Request): Promise<Response> {
  return proxyChatCompletionsForClient(request);
}

export async function proxyAnthropicMessages(
  request: Request,
): Promise<Response> {
  let publicModel = "";
  const response = await proxyChatCompletionsForClient(
    request,
    undefined,
    async (incoming, config) => {
      if (!incoming.headers.get("anthropic-version")) {
        return errorResponse(
          400,
          "invalid_request_error",
          "缺少 anthropic-version 请求头。",
        );
      }
      const body = await readJsonPayload(incoming, config);
      if (body instanceof Response) return body;
      const converted = convertAnthropicRequest(body);
      if ("code" in converted) {
        return errorResponse(400, converted.code, converted.message);
      }
      const requestedModel = resolveModel(converted.payload.model, config);
      if (converted.hasImage && requestedModel?.family !== "qwen") {
        return errorResponse(
          400,
          "model_not_allowed",
          "当前模型不支持 Anthropic Messages 格式的 image 内容块，请改用 Qwen。",
        );
      }
      if (requestedModel && converted.thinkingEnabled !== null) {
        if (requestedModel.family === "qwen") {
          converted.payload.enable_thinking = converted.thinkingEnabled;
          if (converted.thinkingBudget !== null) {
            converted.payload.thinking_budget = converted.thinkingBudget;
          }
        } else if (requestedModel.family === "deepseek") {
          converted.payload.thinking = {
            type: converted.thinkingEnabled ? "enabled" : "disabled",
          };
        }
      }
      const prepared = preparePayload(converted.payload, config);
      if (prepared instanceof Response) return prepared;
      publicModel = prepared.model.alias;
      return prepared;
    },
  );
  if (request.method === "OPTIONS") return response;
  return convertOpenAIResponseToAnthropic(response, publicModel);
}
