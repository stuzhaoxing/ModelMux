import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";


import { competitionError, requireSameOrigin, requireSession } from "@/lib/competition/http";
import {
  discardImageUpload,
  receiveImageUpload,
  registerImageUpload,
} from "@/lib/competition/media";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  try {
    const session = await requireSession(request);
    if (session instanceof NextResponse) return session;

    const upload = await receiveImageUpload(request);
    const role = upload.purpose === "question" ? "judge" : "contestant";
    const user = session.role === role ? session : null;
    if (!user) {
      await discardImageUpload(upload);
      return NextResponse.json({ error: "当前账号无权上传这类图片" }, { status: 403 });
    }

    return NextResponse.json(
      await registerImageUpload({ upload, uploaderId: user.id, uploaderRole: role }),
      { status: 201 },
    );
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const fileError = error as NodeJS.ErrnoException;
    if (code === "unsupported_image" || code === "invalid_image") {
      return NextResponse.json({ error: "仅支持有效的 JPEG、PNG、GIF 或 WebP 图片" }, { status: 400 });
    }
    if (code === "empty_image" || code === "missing_image") {
      return NextResponse.json({ error: "请选择非空图片" }, { status: 400 });
    }
    if (code === "invalid_image_purpose" || code === "invalid_image_count" || code === "invalid_multipart") {
      return NextResponse.json({ error: "图片上传数据格式无效" }, { status: 400 });
    }
    if (fileError.code === "ENOSPC" || fileError.code === "EDQUOT") {
      return NextResponse.json({ error: "服务器磁盘空间不足，无法保存图片" }, { status: 507 });
    }
    return competitionError(error);
  }
}
