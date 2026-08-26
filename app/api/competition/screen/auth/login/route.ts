import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  clearScreenLoginFailures,
  createScreenSessionToken,
  recordScreenLoginFailure,
  screenAuthConfigured,
  screenLoginRetryAfter,
  setScreenSessionCookie,
  verifyScreenPassword,
} from "@/lib/competition/screen-auth";
import { requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";

const loginSchema = z.object({
  password: z.string().min(1).max(300),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!screenAuthConfigured()) {
    return NextResponse.json({ error: "大屏访问密码尚未配置" }, { status: 503 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "密码不正确" }, { status: 401 });

  const retryAfter = screenLoginRetryAfter(request);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (!verifyScreenPassword(parsed.data.password)) {
    recordScreenLoginFailure(request);
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  clearScreenLoginFailures(request);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  setScreenSessionCookie(response, request, createScreenSessionToken());
  return response;
}
