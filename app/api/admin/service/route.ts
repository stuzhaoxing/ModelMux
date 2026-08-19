import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin/auth";
import { requireSameOrigin } from "@/lib/competition/http";
import {
  gatewayServiceState,
  setGatewayServiceEnabled,
} from "@/lib/gateway/service-state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const serviceStateSchema = z.object({ enabled: z.boolean() });

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  return NextResponse.json(await gatewayServiceState(), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const parsed = serviceStateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "服务状态参数无效" }, { status: 400 });
  }
  try {
    return NextResponse.json(
      await setGatewayServiceEnabled(parsed.data.enabled),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to persist gateway service state", error);
    return NextResponse.json(
      { error: "无法保存服务状态，请检查数据目录权限" },
      { status: 500 },
    );
  }
}
