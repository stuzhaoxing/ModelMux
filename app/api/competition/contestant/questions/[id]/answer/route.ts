import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordActivity } from "@/lib/competition/activity";
import { shouldRecordDraftSave } from "@/lib/competition/activity-log";
import { cleanRichText, richTextHasContent } from "@/lib/competition/content";
import { competitionError, parseJson, requireRole, requireSameOrigin } from "@/lib/competition/http";
import { saveAnswer } from "@/lib/competition/repository";

export const runtime = "nodejs";

const answerSchema = z.object({
  contentHtml: z.string().max(2_000_000),
  submit: z.boolean().default(false),
});

export async function PUT(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = await requireRole(request, "contestant");
  if (user instanceof NextResponse) return user;
  const questionId = Number((await context.params).id);
  if (!Number.isSafeInteger(questionId) || questionId < 1) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const input = await parseJson(request, answerSchema);
    const contentHtml = cleanRichText(input.contentHtml);
    if (input.submit && !richTextHasContent(contentHtml)) return NextResponse.json({ error: "答案不能为空" }, { status: 400 });
    const { answer, questionTitle, firstSave } = await saveAnswer({ questionId, contestantId: user.id, contentHtml, submit: input.submit });
    const action = input.submit ? "answer-submitted" : firstSave ? "answer-started" : "answer-saved";
    if (action !== "answer-saved" || shouldRecordDraftSave(`${user.id}:${questionId}`, Date.now())) {
      await recordActivity({
        category: "answer",
        action,
        actorRole: "contestant",
        actorId: user.id,
        actorUsername: user.username,
        actorName: user.displayName,
        questionId,
        questionTitle,
        detail: null,
        outcome: "ok",
      });
    }
    return NextResponse.json({ answer });
  } catch (error) {
    return competitionError(error);
  }
}
