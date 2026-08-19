import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireRole } from "@/lib/competition/http";
import { getQuestion, listAnswersForJudge } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  const id = Number((await context.params).id);
  if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const question = await getQuestion(id);
    if (!question) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
    return NextResponse.json({ question, answers: await listAnswersForJudge(id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return competitionError(error);
  }
}
