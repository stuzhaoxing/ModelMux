import { loadGatewayConfig, publicModels } from "@/lib/gateway/config";
import { startedAt } from "@/lib/gateway/runtime";
import { clientAuthConfigured } from "@/lib/gateway/security";
import { adminAuthConfigured } from "@/lib/admin/auth";
import { healthOutcome } from "@/lib/gateway/health";
import { operationModeState } from "@/lib/gateway/operation-mode";
import { gatewayServiceState } from "@/lib/gateway/service-state";
import { competitionDatabaseHealth } from "@/lib/competition/db-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const config = loadGatewayConfig();
  const [serviceState, modeState, database] = await Promise.all([
    gatewayServiceState(),
    operationModeState(),
    competitionDatabaseHealth(),
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
  // 没配 MODELMUX_DATABASE_URL 的实例是纯网关部署，不参与就绪判定；
  // 配了却连不上才是比赛期间真正要报警的故障。
  const databaseReady = !database.configured || database.reachable;
  const { status, ready } = healthOutcome({
    serviceEnabled: serviceState.enabled,
    configured,
    databaseReady,
  });
  const apiReady = serviceState.enabled && configured;

  return Response.json(
    {
      status,
      ready,
      apiReady,
      serviceEnabled: serviceState.enabled,
      serviceStateFileValid: serviceState.stateFileValid,
      operationMode: modeState.mode,
      operationModeStateFileValid: modeState.stateFileValid,
      database,
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
