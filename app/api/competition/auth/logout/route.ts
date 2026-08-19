import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/competition/activity";
import { clearSessionCookie, destroySession, sessionUser } from "@/lib/competition/auth";
import { competitionError, requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  try {
    const user = await sessionUser(request);
    await destroySession(request);
    if (user) {
      await recordActivity({
        category: "auth",
        action: "logout",
        actorRole: user.role,
        actorId: user.id,
        actorUsername: user.username,
        actorName: user.displayName,
        questionId: null,
        questionTitle: null,
        detail: null,
        outcome: "ok",
      });
    }
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return competitionError(error);
  }
}
