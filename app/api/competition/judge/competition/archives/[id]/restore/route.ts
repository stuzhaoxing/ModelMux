import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { restoreCompetitionArchive } from "@/lib/competition/archives";
import { competitionError, parseJson, requireJudgeOperator, requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";
const schema = z.object({ confirmation: z.literal("恢复归档"), generation: z.number().int().nonnegative() });
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const operator = requireJudgeOperator(request);
  if (operator instanceof NextResponse) return operator;
  try {
    const input = await parseJson(request, schema);
    const { id } = await context.params;
    return NextResponse.json(await restoreCompetitionArchive(id, input.generation, operator.displayName));
  } catch (error) { return competitionError(error); }
}
