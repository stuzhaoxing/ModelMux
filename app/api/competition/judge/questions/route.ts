import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordActivity } from "@/lib/competition/activity";
import { cleanRichText, richTextHasContent } from "@/lib/competition/content";
import { competitionError, parseJson, requireRole, requireSameOrigin } from "@/lib/competition/http";
import { createQuestion, getQuestion, listJudgeQuestions } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const questionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  contentHtml: z.string().max(2_000_000),
  publish: z.boolean().default(false),
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  try {
    return NextResponse.json({ questions: await listJudgeQuestions() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return competitionError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  try {
    const input = await parseJson(request, questionSchema);
    const contentHtml = cleanRichText(input.contentHtml);
    if (!richTextHasContent(contentHtml)) return NextResponse.json({ error: "题目内容不能为空" }, { status: 400 });
    const id = await createQuestion({ authorId: user.id, title: input.title, contentHtml, publish: input.publish });
    await recordActivity({
      category: "question",
      action: input.publish ? "question-published" : "question-created",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: id,
      questionTitle: input.title,
      detail: null,
      outcome: "ok",
    });
    return NextResponse.json({ id, question: await getQuestion(id) }, { status: 201 });
  } catch (error) {
    return competitionError(error);
  }
}
