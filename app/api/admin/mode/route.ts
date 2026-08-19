import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin/auth";
import { requireSameOrigin } from "@/lib/competition/http";
import { resetContestantRequestUsage } from "@/lib/competition/repository";
import {
  operationModeState,
  setOperationMode,
} from "@/lib/gateway/operation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operationModeSchema = z.object({
  mode: z.enum(["test", "competition"]),
  resetUsage: z.boolean().default(false),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await operationModeState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const parsed = operationModeSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "运行模式参数无效" }, { status: 400 });
  }

  let state;
  try {
    state = await setOperationMode(parsed.data.mode);
  } catch (error) {
    console.error("Failed to persist gateway operation mode", error);
    return NextResponse.json(
      { error: "无法保存运行模式，请检查数据目录权限" },
      { status: 500 },
    );
  }

  // 模式已经落盘，清零失败不应该回滚模式，只回报为部分成功。
  if (!parsed.data.resetUsage) {
    return NextResponse.json(
      { ...state, usageReset: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
  try {
    return NextResponse.json(
      { ...state, usageReset: await resetContestantRequestUsage() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to reset contestant request usage", error);
    return NextResponse.json(
      {
        ...state,
        usageReset: null,
        warning: "运行模式已切换，但清零选手已用次数失败，请检查考核数据库。",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
