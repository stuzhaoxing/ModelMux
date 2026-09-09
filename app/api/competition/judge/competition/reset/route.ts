import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { resetCompetitionAnswers } from "@/lib/competition/archives";
import { competitionError, parseJson, requireJudgeOperator, requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";
const schema = z.object({ confirmation: z.literal("归档并重置"), generation: z.number().int().nonnegative() });
export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const operator = requireJudgeOperator(request);
  if (operator instanceof NextResponse) return operator;
  try {
    const input = await parseJson(request, schema);
    return NextResponse.json(await resetCompetitionAnswers(input.generation, operator.displayName));
  } catch (error) { return competitionError(error); }
}
