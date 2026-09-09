import { NextResponse } from "next/server";

import { competitionOperationMode } from "@/lib/competition/mode";
import { competitionError } from "@/lib/competition/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 考务工作台和选手端（含登录页）都要显示当前模式，所以这里不要求会话，
// 只返回模式本身，不含任何账号或密钥信息。
export async function GET(): Promise<NextResponse> {
  try {
    const state = await competitionOperationMode();
    return NextResponse.json(
      {
        mode: state.mode,
        updatedAt: state.updatedAt,
        stateFileValid: state.stateFileValid,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return competitionError(error);
  }
}
