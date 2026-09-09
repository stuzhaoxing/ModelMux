import { NextResponse } from "next/server";

import { getCompetitionScreenSnapshot } from "@/lib/competition/screen";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getCompetitionScreenSnapshot(), {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("[competition] 大屏快照读取失败", error);
    return NextResponse.json(
      { error: "大屏数据暂不可用" },
      { status: 503, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
