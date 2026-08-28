import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { createCompetitionUserRequestSchema } from "@/lib/competition/accounts";
import { competitionError, parseJson, requireSameOrigin } from "@/lib/competition/http";
import { createGeneratedUser, createUser, listUsers } from "@/lib/competition/repository";
import { loadGatewayConfig } from "@/lib/gateway/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contestantApiBase(request: NextRequest): string {
  const config = loadGatewayConfig();
  const configuredBase = config.deploymentMode === "local"
    ? config.internalBaseUrl
    : config.publicBaseUrl;
  return `${configuredBase ?? request.nextUrl.origin}/v1`;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json(
      {
        users: (await listUsers()).filter((user) => user.role === "contestant"),
        apiBase: contestantApiBase(request),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return competitionError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  try {
    const input = await parseJson(request, createCompetitionUserRequestSchema);
    if ("autoGenerate" in input) {
      const user = await createGeneratedUser(input.role);
      return NextResponse.json(
        { user, apiBase: contestantApiBase(request) },
        { status: 201 },
      );
    }
    const id = await createUser(input);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return competitionError(error);
  }
}
