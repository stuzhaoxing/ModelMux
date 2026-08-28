import { randomUUID } from "node:crypto";

import { loadGatewayConfig, providerKeys } from "./config";
import { errorResponse, optionsResponse, withCors } from "./http";
import {
  nextProviderKey,
  recordRequest,
} from "./runtime";
import {
  authenticateClient,
  clientAuthConfigured,
  type ClientIdentity,
} from "./security";
import { gatewayServiceState } from "./service-state";
import type {
  GatewayConfig,
  ModelRouteGroup,
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

function requestHeaders(request: Request, providerKey: string): Headers {
  const headers = new Headers();
  request.headers.forEach((value, name) => {
    const lower = name.toLowerCase();
    if (
      HOP_BY_HOP_HEADERS.has(lower) ||
      lower === "authorization"
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
  return config.models.find((model) => model.alias === requested) ?? null;
}

function providerPayload(
  payload: Record<string, unknown>,
  model: ModelRouteGroup,
  route: ProviderRoute,
): Record<string, unknown> {
  return route.upstreamModel === model.alias
    ? payload
    : { ...payload, model: route.upstreamModel };
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

  return { payload, model };
}

async function readJsonPayload(
  request: Request,
): Promise<Record<string, unknown> | Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse(400, "invalid_json", "请求体必须是有效的 JSON 对象。");
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return errorResponse(400, "invalid_json", "请求体必须是有效的 JSON 对象。");
  }

  return payload as Record<string, unknown>;
}

async function prepareRequest(
  request: Request,
  config: GatewayConfig,
): Promise<PreparedRequest | Response> {
  const payload = await readJsonPayload(request);
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

async function proxyChatCompletionsForClient(
  request: Request,
  providedClient?: ClientIdentity,
  prepare: RequestPreparer = prepareRequest,
): Promise<Response> {
  const config = loadGatewayConfig();
  if (request.method === "OPTIONS") return optionsResponse(request, config);
  const serviceState = await gatewayServiceState();
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

  const requestId = randomUUID();
  const beganAt = Date.now();
  let lastStatus = 502;
  let lastErrorCode = "upstream_unreachable";

  for (let index = 0; index < attempts.length; index += 1) {
    const { route, key } = attempts[index];
    try {
      const upstream = await fetch(
        `${route.baseUrl}${route.chatCompletionsPath ?? "/v1/chat/completions"}`,
        {
          method: "POST",
          headers: requestHeaders(request, key),
          body: JSON.stringify(
            providerPayload(prepared.payload, prepared.model, route),
          ),
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(config.requestTimeoutMs),
        },
      );
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

      const headers = responseHeaders(upstream);
      headers.set("X-ModelMux-Request-Id", requestId);
      headers.set("X-ModelMux-Provider", route.provider);
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

  return withCors(
    errorResponse(
      lastStatus,
      lastErrorCode,
      lastStatus === 504 ? "上游模型响应超时。" : "无法连接上游模型服务。",
      {
        "X-ModelMux-Request-Id": requestId,
      },
    ),
    request,
    config,
  );
}

export async function proxyChatCompletions(request: Request): Promise<Response> {
  return proxyChatCompletionsForClient(request);
}
