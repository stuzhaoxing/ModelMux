import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionAllowsAnswers, competitionIsTesting } from "@/lib/competition/control";

import { competitionError, requireRole } from "@/lib/competition/http";
import { getCompetitionControl, listAnswersForContestant, listContestantQuestions } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRole(request, "contestant");
  if (user instanceof NextResponse) return user;
  try {
    const competition = await getCompetitionControl();
    if (!competitionAllowsAnswers(competition)) {
      return NextResponse.json({ questions: [], answers: [], competition }, { headers: { "Cache-Control": "no-store" } });
    }
    const phase = competitionIsTesting(competition) ? "test" : competition.phase;
    const [questions, answers] = await Promise.all([
      listContestantQuestions(phase),
      listAnswersForContestant(user.id, phase),
    ]);
    return NextResponse.json({ questions, answers, competition }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return competitionError(error);
  }
}
