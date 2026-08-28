import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/competition/activity";
import {
  clearCompetitionLoginFailures,
  competitionLoginRetryAfter,
  destroySession,
  issueSession,
  matchCredentials,
  recordCompetitionLoginFailure,
  setSessionCookie,
} from "@/lib/competition/auth";
import { competitionError, parseJson, requireSameOrigin } from "@/lib/competition/http";
import { loginInputSchema, type LoginInput } from "@/lib/competition/login-input";
import { loginRedirectTarget } from "@/lib/competition/navigation";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  let input: LoginInput;
  try {
    input = await parseJson(request, loginInputSchema);
  } catch {
    return NextResponse.json({ error: "请输入账号和密码" }, { status: 400 });
  }

  try {
    const retryAfter = competitionLoginRetryAfter(request, "any", input.username);
    if (retryAfter > 0) {
      return NextResponse.json(
        { error: "登录尝试过于频繁，请稍后再试" },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const matches = await matchCredentials(input.username, input.password, "contestant");
    if (matches.length === 0) {
      recordCompetitionLoginFailure(request, "any", input.username);
      return NextResponse.json({ error: "账号或密码不正确" }, { status: 401 });
    }
    const match = matches[0];
    clearCompetitionLoginFailures(request, "any", input.username);
    // 会话 cookie 全站只有一个，新登录会覆盖它；顺手把旧会话在库里也作废，
    // 这样一台电脑同一时刻只可能是一个身份。
    await destroySession(request);
    const session = await issueSession(match);
    await recordActivity({
      category: "auth",
      action: "login",
      actorRole: match.role,
      actorId: session.user.id,
      actorUsername: session.user.username,
      actorName: session.user.displayName,
      questionId: null,
      questionTitle: null,
      detail: "选手端",
      outcome: "ok",
    });

    const response = NextResponse.json({
      user: session.user,
      redirectTo: loginRedirectTarget(match.role, input.next),
    });
    setSessionCookie(response, request, session.token);
    return response;
  } catch (error) {
    return competitionError(error);
  }
}
