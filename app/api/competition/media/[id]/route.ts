import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { competitionError, requireSession } from "@/lib/competition/http";
import { contestantCanReadImage, readImage } from "@/lib/competition/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const session = await requireSession(request);
    if (session instanceof NextResponse) return session;
    const judge = session.role === "judge" ? session : null;
    const contestant = session.role === "contestant" ? session : null;
    const id = Number((await context.params).id);
    if (!Number.isSafeInteger(id) || id < 1) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    const image = await readImage(id);
    if (!image) return NextResponse.json({ error: "图片不存在" }, { status: 404 });
    if (!judge && contestant && !(await contestantCanReadImage(id, contestant.id, image))) {
      return NextResponse.json({ error: "无权查看这张图片" }, { status: 403 });
    }
    return new Response(image.stream as unknown as BodyInit, {
      headers: {
        "Content-Type": image.mimeType,
        "Content-Length": String(image.byteSize),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(image.originalName)}`,
        "Cache-Control": "private, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return competitionError(error);
  }
}
