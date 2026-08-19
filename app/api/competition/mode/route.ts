import { NextResponse } from "next/server";

import { operationModeState } from "@/lib/gateway/operation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 评委端和选手端（含登录页）都要显示当前模式，所以这里不要求会话，
// 只返回模式本身，不含任何账号、额度或密钥信息。
export async function GET(): Promise<NextResponse> {
  const state = await operationModeState();
  return NextResponse.json(
    {
      mode: state.mode,
      updatedAt: state.updatedAt,
      stateFileValid: state.stateFileValid,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
