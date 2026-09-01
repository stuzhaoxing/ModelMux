import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  competitionError,
  parseJson,
  requireJudgeOperator,
  requireSameOrigin,
} from "@/lib/competition/http";
import {
  getCompetitionScreenNotice,
  updateCompetitionScreenNotice,
} from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const screenNoticeSchema = z.object({
  title: z.string().trim().min(1).max(40),
  content: z.string().trim().max(300),
  enabled: z.boolean(),
}).refine((value) => !value.enabled || value.content.length > 0, {
  message: "展示公告前请先填写正文",
  path: ["content"],
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  try {
    return NextResponse.json({ notice: await getCompetitionScreenNotice() }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return competitionError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const user = requireJudgeOperator(request);
  if (user instanceof NextResponse) return user;
  try {
    const input = await parseJson(request, screenNoticeSchema);
    return NextResponse.json({
      notice: await updateCompetitionScreenNotice(input),
    });
  } catch (error) {
    return competitionError(error);
  }
}
