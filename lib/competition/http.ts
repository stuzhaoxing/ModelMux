import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { forbidden, hasSameOrigin, sessionUser, unauthorized } from "./auth";
import type { CompetitionRole, SessionUser } from "./types";

export async function requireRole(
  request: NextRequest,
  role: CompetitionRole,
): Promise<SessionUser | NextResponse> {
  try {
    const user = await sessionUser(request);
    if (!user) return unauthorized();
    return user.role === role ? user : forbidden();
  } catch (error) {
    return competitionError(error);
  }
}

export async function requireSession(
  request: NextRequest,
): Promise<SessionUser | NextResponse> {
  try {
    return (await sessionUser(request)) ?? unauthorized();
  } catch (error) {
    return competitionError(error);
  }
}

export function requireSameOrigin(request: NextRequest): NextResponse | null {
  return hasSameOrigin(request)
    ? null
    : NextResponse.json({ error: "请求来源无效" }, { status: 403 });
}

export async function parseJson<T>(request: NextRequest, schema: ZodType<T>): Promise<T> {
  return schema.parse(await request.json());
}

export function competitionError(error: unknown): NextResponse {
  const code = error instanceof Error ? error.message : "unknown_error";
  const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
  const invalid = typeof error === "object" && error !== null && "issues" in error;
  const databaseUnavailable = code.includes("MODELMUX_DATABASE_URL") || code.includes("ECONNREFUSED") || code.includes("Access denied");

  if (duplicate) return NextResponse.json({ error: "登录账号已经存在" }, { status: 409 });
  if (invalid) return NextResponse.json({ error: "提交内容不完整或格式不正确" }, { status: 400 });
  if (code === "question_not_found") return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  if (code === "question_not_open") return NextResponse.json({ error: "题目已经关闭，不能继续作答" }, { status: 409 });
  if (code === "answer_locked") return NextResponse.json({ error: "答案已最终提交，不能再修改" }, { status: 409 });
  if (databaseUnavailable) {
    return NextResponse.json({ error: "考核数据库尚未配置或无法连接" }, { status: 503 });
  }
  console.error("Competition request failed", error);
  return NextResponse.json({ error: "服务器处理请求失败" }, { status: 500 });
}
