import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { gatewayStatus } from "@/lib/gateway/config";
import { metrics, recentLogs, startedAt } from "@/lib/gateway/runtime";
import { operationModeState } from "@/lib/gateway/operation-mode";
import { gatewayServiceState } from "@/lib/gateway/service-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const origin = new URL(request.url).origin;
  const [serviceState, modeState] = await Promise.all([
    gatewayServiceState(),
    operationModeState(),
  ]);
  return Response.json(
    {
      gateway: gatewayStatus(origin, startedAt(), process.env, serviceState, modeState),
      metrics: metrics(),
      logs: recentLogs(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
