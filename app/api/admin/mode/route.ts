import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { competitionError } from "@/lib/competition/http";
import { operationModeState } from "@/lib/gateway/operation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  try {
    return NextResponse.json(await operationModeState(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return competitionError(error);
  }
}
