import { loadGatewayConfig } from "@/lib/gateway/config";
import { errorResponse, optionsResponse, withCors } from "@/lib/gateway/http";
import { authenticateClient, clientAuthConfigured } from "@/lib/gateway/security";
import { gatewayServiceState } from "@/lib/gateway/service-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const config = loadGatewayConfig();
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
  if (!clientAuthConfigured(config)) {
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

  if (!(await authenticateClient(request, config))) {
    return withCors(
      Response.json(
        {
          error: {
            message: "缺少或无效的选手 API Key。",
            type: "invalid_request_error",
            code: "invalid_api_key",
          },
        },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      ),
      request,
      config,
    );
  }

  return withCors(
    Response.json({
      object: "list",
      data: config.models.map((model) => ({
        id: model.alias,
        object: "model",
        created: 0,
        owned_by: "modelmux",
        root: model.alias,
      })),
    }),
    request,
    config,
  );
}

export async function OPTIONS(request: Request): Promise<Response> {
  return optionsResponse(request, loadGatewayConfig());
}
