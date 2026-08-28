import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireRole } from "@/lib/competition/http";
import { contestantApiAccess } from "@/lib/competition/repository";
import type { ContestantApiAccess } from "@/lib/competition/types";
import { loadGatewayConfig } from "@/lib/gateway/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRole(request, "contestant");
  if (user instanceof NextResponse) return user;

  try {
    const access = await contestantApiAccess(user.id);
    if (!access) {
      return NextResponse.json(
        { error: "当前账号尚未分配模型 API 访问权限" },
        { status: 404 },
      );
    }

    const config = loadGatewayConfig();
    const configuredBase = config.deploymentMode === "local"
      ? config.internalBaseUrl
      : config.publicBaseUrl;
    const origin = configuredBase ?? request.nextUrl.origin;
    const payload: ContestantApiAccess = {
      apiBase: `${origin}/v1`,
      apiKey: access.apiKey,
      models: config.models.map((model) => ({
        id: model.alias,
        name: model.displayName,
        description: model.description,
        family: model.family,
        inputModalities: model.inputModalities,
        contextWindowTokens: model.contextWindowTokens,
      })),
    };

    return NextResponse.json(
      { access: payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return competitionError(error);
  }
}
