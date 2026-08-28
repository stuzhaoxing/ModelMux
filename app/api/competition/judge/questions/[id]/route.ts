import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordActivity } from "@/lib/competition/activity";
import { cleanRichText, richTextHasContent } from "@/lib/competition/content";
import { competitionError, parseJson, requireJudgeOperator, requireSameOrigin } from "@/lib/competition/http";
import {
  deleteQuestionWhileStopped,
  getCompetitionControl,
  getQuestion,
  listJudgeQuestions,
  updateQuestion,
} from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({ action: z.literal("update"), title: z.string().trim().min(1).max(200), contentHtml: z.string().max(2_000_000), expectedVersion: z.number().int().positive() });

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  const id = numericId((await context.params).id);
  if (!id) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const question = await getQuestion(id);
    return question ? NextResponse.json({ question }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "题目不存在" }, { status: 404 });
  } catch (error) {
    return competitionError(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  const id = numericId((await context.params).id);
  if (!id) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const input = await parseJson(request, updateSchema);
    const contentHtml = cleanRichText(input.contentHtml);
    if (!richTextHasContent(contentHtml)) return NextResponse.json({ error: "题目内容不能为空" }, { status: 400 });
    const changed = await updateQuestion({ id, title: input.title, contentHtml, expectedVersion: input.expectedVersion });
    if (!changed) return NextResponse.json({ error: "题目已发布、关闭或被其他评委修改，请刷新后重试" }, { status: 409 });
    const question = await getQuestion(id);
    await recordActivity({
      category: "question",
      action: "question-updated",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: id,
      questionTitle: question?.title ?? null,
      detail: null,
      outcome: "ok",
    });
    return NextResponse.json({ question });
  } catch (error) {
    return competitionError(error);
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  const id = numericId((await context.params).id);
  if (!id) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const deleted = await deleteQuestionWhileStopped(id);
    await recordActivity({
      category: "question",
      action: "question-deleted",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: id,
      questionTitle: deleted.title,
      detail: deleted.answerCount > 0 ? `同时删除 ${deleted.answerCount} 份已有答卷` : null,
      outcome: "warn",
    });
    const [questions, competition] = await Promise.all([
      listJudgeQuestions(),
      getCompetitionControl(),
    ]);
    return NextResponse.json({ deleted: { id, ...deleted }, questions, competition });
  } catch (error) {
    return competitionError(error);
  }
}
