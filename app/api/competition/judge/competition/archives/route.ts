import { NextResponse, type NextRequest } from "next/server";
import { listCompetitionArchives } from "@/lib/competition/archives";
import { competitionError, requireJudgeOperator } from "@/lib/competition/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const operator = requireJudgeOperator(request);
  if (operator instanceof NextResponse) return operator;
  try {
    return NextResponse.json({ archives: await listCompetitionArchives() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return competitionError(error); }
}
