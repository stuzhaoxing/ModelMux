import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireSession } from "@/lib/competition/http";
import type { SessionUser } from "@/lib/competition/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const user = await requireSession(request);
    if (user instanceof NextResponse) return user;
    return NextResponse.json({ user: user as SessionUser }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return competitionError(error);
  }
}
