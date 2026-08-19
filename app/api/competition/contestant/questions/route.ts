import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireRole } from "@/lib/competition/http";
import { listAnswersForContestant, listContestantQuestions } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRole(request, "contestant");
  if (user instanceof NextResponse) return user;
  try {
    const [questions, answers] = await Promise.all([
      listContestantQuestions(),
      listAnswersForContestant(user.id),
    ]);
    return NextResponse.json({ questions, answers }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return competitionError(error);
  }
}
