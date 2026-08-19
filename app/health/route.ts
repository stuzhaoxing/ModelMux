import { loadGatewayConfig, publicModels } from "@/lib/gateway/config";
import { startedAt } from "@/lib/gateway/runtime";
import { clientAuthConfigured } from "@/lib/gateway/security";
import { adminAuthConfigured } from "@/lib/admin/auth";
import { operationModeState } from "@/lib/gateway/operation-mode";
import { gatewayServiceState } from "@/lib/gateway/service-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = loadGatewayConfig();
  const [serviceState, modeState] = await Promise.all([
    gatewayServiceState(),
    operationModeState(),
  ]);
  const models = publicModels(config);
  const providerConfigured = models.every((model) =>
    model.routes.some((route) => route.configured),
  );
  const adminConfigured = adminAuthConfigured();
  const configured =
    providerConfigured &&
    clientAuthConfigured(config) &&
    adminConfigured;
  const apiReady = serviceState.enabled && configured;
  const ready = serviceState.enabled ? configured : true;

  return Response.json(
    {
      status: serviceState.enabled
        ? ready ? "ok" : "needs_config"
        : "suspended",
      ready,
      apiReady,
      serviceEnabled: serviceState.enabled,
      serviceStateFileValid: serviceState.stateFileValid,
      operationMode: modeState.mode,
      operationModeStateFileValid: modeState.stateFileValid,
      service: "modelmux-gateway",
      version: "0.2.0",
      deploymentMode: config.deploymentMode,
      startedAt: startedAt(),
    },
    {
      status: ready ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
