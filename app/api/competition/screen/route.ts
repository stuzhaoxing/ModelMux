import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireCompetitionScreen } from "@/lib/competition/screen-auth";
import { getCompetitionScreenSnapshot } from "@/lib/competition/screen";
import {
  competitionScreenMockEnabled,
  getCompetitionScreenMockSnapshot,
} from "@/lib/competition/screen-mock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const access = requireCompetitionScreen(request);
  if (access instanceof NextResponse) return access;

  try {
    const mockMode = competitionScreenMockEnabled()
      && request.nextUrl.searchParams.get("mock") === "1";
    const now = Date.now();
    const requestedStartedAt = Number(request.nextUrl.searchParams.get("startedAt"));
    const mockStartedAt = Number.isSafeInteger(requestedStartedAt)
      && requestedStartedAt > 0
      && requestedStartedAt <= now + 5_000
      ? requestedStartedAt
      : undefined;
    return NextResponse.json(mockMode
      ? await getCompetitionScreenMockSnapshot(process.env, now, mockStartedAt)
      : await getCompetitionScreenSnapshot(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[competition] 大屏快照读取失败", error);
    return NextResponse.json(
      { error: "大屏数据暂不可用" },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
