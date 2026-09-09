import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { gatewayStatus } from "@/lib/gateway/config";
import { metrics, recentLogs, startedAt } from "@/lib/gateway/runtime";
import { operationModeState } from "@/lib/gateway/operation-mode";
import { competitionError } from "@/lib/competition/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const origin = new URL(request.url).origin;
  try {
    const modeState = await operationModeState();
    return Response.json(
      {
        gateway: gatewayStatus(origin, startedAt(), process.env, modeState),
        metrics: metrics(),
        logs: recentLogs(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return competitionError(error);
  }
}
