import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/competition/activity";
import { competitionError, requireRole, requireSameOrigin } from "@/lib/competition/http";
import { listJudgeQuestions, stopCompetition } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  try {
    const result = await stopCompetition();
    await recordActivity({
      category: "question",
      action: "competition-stopped",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: null,
      questionTitle: null,
      detail: `停止比赛，${result.questionCount} 道题目已对选手隐藏`,
      outcome: "warn",
    });
    return NextResponse.json({
      competition: result.competition,
      questions: await listJudgeQuestions(),
    });
  } catch (error) {
    return competitionError(error);
  }
}
