import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  adminAuthConfigured,
  adminLoginRetryAfter,
  clearAdminLoginFailures,
  createAdminSessionToken,
  recordAdminLoginFailure,
  setAdminSessionCookie,
  verifyAdminPassword,
} from "@/lib/admin/auth";
import { requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";

const loginSchema = z.object({
  password: z.string().min(1).max(300),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  if (!adminAuthConfigured()) {
    return NextResponse.json({ error: "管理员登录尚未配置" }, { status: 503 });
  }

  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "密码不正确" }, { status: 401 });

  const retryAfter = adminLoginRetryAfter(request);
  if (retryAfter > 0) {
    return NextResponse.json(
      { error: "登录尝试过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  if (!verifyAdminPassword(parsed.data.password)) {
    recordAdminLoginFailure(request);
    return NextResponse.json({ error: "密码不正确" }, { status: 401 });
  }

  clearAdminLoginFailures(request);
  const response = NextResponse.json(
    { ok: true },
    { headers: { "Cache-Control": "no-store" } },
  );
  setAdminSessionCookie(response, request, createAdminSessionToken());
  return response;
}
