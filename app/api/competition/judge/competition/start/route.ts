import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordActivity } from "@/lib/competition/activity";
import { competitionError, parseJson, requireJudgeOperator, requireSameOrigin } from "@/lib/competition/http";
import { listJudgeQuestions, startCompetition } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startSchema = z.object({
  durationMinutes: z.number().int().min(1),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  try {
    const input = await parseJson(request, startSchema);
    const result = await startCompetition(input.durationMinutes);
    await recordActivity({
      category: "question",
      action: "competition-started",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: null,
      questionTitle: null,
      detail: `开始比赛，开放 ${result.questionCount} 道题目，限时 ${input.durationMinutes} 分钟`,
      outcome: "ok",
    });
    return NextResponse.json({
      competition: result.competition,
      questions: await listJudgeQuestions(),
    });
  } catch (error) {
    return competitionError(error);
  }
}
