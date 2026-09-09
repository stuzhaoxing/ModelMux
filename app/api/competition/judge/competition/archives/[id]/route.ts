import { NextResponse, type NextRequest } from "next/server";
import { getCompetitionArchive } from "@/lib/competition/archives";
import { competitionError, requireJudgeOperator } from "@/lib/competition/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const operator = requireJudgeOperator(request);
  if (operator instanceof NextResponse) return operator;
  try {
    const { id } = await context.params;
    const result = await getCompetitionArchive(id);
    return NextResponse.json({ formatVersion: 1, ...result }, { headers: {
      "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      "Content-Disposition": `attachment; filename="competition-archive-${result.archive.id}.json"`,
    } });
  } catch (error) { return competitionError(error); }
}
