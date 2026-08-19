import type { GatewayConfig } from "./types";

export function errorResponse(
  status: number,
  code: string,
  message: string,
  extraHeaders?: HeadersInit,
): Response {
  return Response.json(
    {
      error: {
        message,
        type: status >= 500 ? "gateway_error" : "invalid_request_error",
        code,
      },
    },
    { status, headers: extraHeaders },
  );
}

export function corsHeaders(request: Request, config: GatewayConfig): Headers {
  const headers = new Headers();
  const origin = request.headers.get("origin");
  if (!origin || config.corsOrigins.length === 0) return headers;

  if (config.corsOrigins.includes("*") || config.corsOrigins.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
    headers.set(
      "Access-Control-Allow-Headers",
      "Authorization, Content-Type, X-Api-Key, Anthropic-Version, Anthropic-Beta",
    );
    headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "86400");
  }
  return headers;
}

export function withCors(
  response: Response,
  request: Request,
  config: GatewayConfig,
): Response {
  const headers = new Headers(response.headers);
  corsHeaders(request, config).forEach((value, key) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function optionsResponse(request: Request, config: GatewayConfig): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, config) });
}
