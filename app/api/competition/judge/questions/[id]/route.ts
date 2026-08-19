import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import { recordActivity } from "@/lib/competition/activity";
import { cleanRichText, richTextHasContent } from "@/lib/competition/content";
import { competitionError, parseJson, requireRole, requireSameOrigin } from "@/lib/competition/http";
import { closeQuestion, getQuestion, publishQuestion, updateQuestion } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update"), title: z.string().trim().min(1).max(200), contentHtml: z.string().max(2_000_000), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("publish"), title: z.string().trim().min(1).max(200), contentHtml: z.string().max(2_000_000), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("close") }),
]);

function numericId(value: string): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const user = await requireRole(request, "judge");
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
  const user = await requireRole(request, "judge");
  if (user instanceof NextResponse) return user;
  const id = numericId((await context.params).id);
  if (!id) return NextResponse.json({ error: "题目不存在" }, { status: 404 });
  try {
    const input = await parseJson(request, updateSchema);
    let changed = false;
    if (input.action === "update" || input.action === "publish") {
      const contentHtml = cleanRichText(input.contentHtml);
      if (!richTextHasContent(contentHtml)) return NextResponse.json({ error: "题目内容不能为空" }, { status: 400 });
      changed = input.action === "update"
        ? await updateQuestion({ id, title: input.title, contentHtml, expectedVersion: input.expectedVersion })
        : await publishQuestion({ id, title: input.title, contentHtml, expectedVersion: input.expectedVersion });
    } else {
      changed = await closeQuestion(id);
    }
    if (!changed) return NextResponse.json({ error: "题目已发布、关闭或被其他评委修改，请刷新后重试" }, { status: 409 });
    const question = await getQuestion(id);
    await recordActivity({
      category: "question",
      action: input.action === "update"
        ? "question-updated"
        : input.action === "publish"
          ? "question-published"
          : "question-closed",
      actorRole: "judge",
      actorId: user.id,
      actorUsername: user.username,
      actorName: user.displayName,
      questionId: id,
      questionTitle: question?.title ?? null,
      detail: input.action === "close" ? "选手已不能再提交" : null,
      outcome: "ok",
    });
    return NextResponse.json({ question });
  } catch (error) {
    return competitionError(error);
  }
}
