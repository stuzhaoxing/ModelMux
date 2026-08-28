import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin/auth";
import { requireSameOrigin } from "@/lib/competition/http";
import {
  operationModeState,
  setOperationMode,
} from "@/lib/gateway/operation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const operationModeSchema = z.object({
  mode: z.enum(["test", "competition"]),
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

  return NextResponse.json(state, {
    headers: { "Cache-Control": "no-store" },
  });
}
