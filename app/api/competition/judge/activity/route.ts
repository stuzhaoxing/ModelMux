import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  activityAfter,
  activityBefore,
  activityTotal,
  recentActivity,
} from "@/lib/competition/activity";
import { competitionError, requireRole } from "@/lib/competition/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function positiveInt(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  try {
    const after = positiveInt(request.nextUrl.searchParams.get("after"), 0);
    const before = positiveInt(request.nextUrl.searchParams.get("before"), 0);
    const limit = Math.min(200, positiveInt(request.nextUrl.searchParams.get("limit"), 120));
    // Newest first in every mode, so the client can splice a batch in directly.
    const activity = before > 0
      ? await activityBefore(before, limit)
      : after > 0
        ? (await activityAfter(after, limit)).reverse()
        : await recentActivity(limit);
    return NextResponse.json(
      { activity, total: await activityTotal(), reachedStart: before > 0 && activity.length < limit },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return competitionError(error);
  }
}
