import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import type { ZodType } from "zod";

import { requireAdmin } from "@/lib/admin/auth";

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

export interface JudgeOperator {
  id: null;
  role: "judge";
  username: "admin";
  displayName: "管理员";
}

export function requireJudgeOperator(
  request: NextRequest,
): JudgeOperator | NextResponse {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return {
    id: null,
    role: "judge",
    username: "admin",
    displayName: "管理员",
  };
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
  if (code === "question_set_empty") return NextResponse.json({ error: "请先保存至少一道题目" }, { status: 409 });
  if (code === "question_set_published") return NextResponse.json({ error: "题目已经统一发布，不能再次发布或新增" }, { status: 409 });
  if (code === "question_set_conflict") return NextResponse.json({ error: "题目集刚刚发生变化，请刷新后重试" }, { status: 409 });
  if (code === "competition_running") return NextResponse.json({ error: "比赛进行中不能管理题目，请先停止比赛" }, { status: 409 });
  if (code === "competition_not_running") return NextResponse.json({ error: "比赛当前不在进行中" }, { status: 409 });
  if (code === "competition_control_missing") return NextResponse.json({ error: "比赛状态尚未初始化" }, { status: 503 });
  if (code === "export_font_missing") return NextResponse.json({ error: "服务器尚未配置中文 PDF 导出字体" }, { status: 503 });
  if (databaseUnavailable) {
    return NextResponse.json({ error: "考核数据库尚未配置或无法连接" }, { status: 503 });
  }
  console.error("Competition request failed", error);
  return NextResponse.json({ error: "服务器处理请求失败" }, { status: 500 });
}
