import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireJudgeOperator, requireSession } from "@/lib/competition/http";
import { contestantCanReadMedia, mediaContentDisposition, readMedia } from "@/lib/competition/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const session = await requireSession(request);
    const admin = requireJudgeOperator(request);
    if (session instanceof NextResponse && admin instanceof NextResponse) return session;
    const isAdmin = !(admin instanceof NextResponse);
    const contestant = session instanceof NextResponse || session.role !== "contestant"
      ? null
      : session;
    if (!isAdmin && !contestant) {
      return NextResponse.json({ error: "当前账号无权下载这个附件" }, { status: 403 });
    }
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    const media = await readMedia(id);
    if (!media) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
    if (!isAdmin && contestant && !(await contestantCanReadMedia(id, contestant.id, media))) {
      await media.stream.cancel().catch(() => undefined);
      return NextResponse.json({ error: "无权下载这个附件" }, { status: 403 });
    }
    const headers: Record<string, string> = {
      "Content-Type": media.kind === "image" ? media.mimeType : "application/octet-stream",
      "Content-Length": media.byteSize,
      "Content-Disposition": mediaContentDisposition(media.kind, media.originalName),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    };
    if (media.kind === "file") headers["Content-Security-Policy"] = "sandbox";
    return new Response(media.stream as unknown as BodyInit, {
      headers,
    });
  } catch (error) {
    return competitionError(error);
  }
}
