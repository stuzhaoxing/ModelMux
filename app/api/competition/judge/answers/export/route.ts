import { createReadStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { createJudgeAnswerArchive } from "@/lib/competition/judge-export";
import { competitionError, requireJudgeOperator } from "@/lib/competition/http";
import { getJudgeAnswerExportSnapshot } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const user = requireJudgeOperator(request);
    if (user instanceof NextResponse) return user;

    const archive = await createJudgeAnswerArchive(await getJudgeAnswerExportSnapshot());
    const stream = createReadStream(archive.filePath);
    const cleanup = () => void rm(archive.directory, { recursive: true, force: true }).catch(() => undefined);
    stream.once("close", cleanup);
    stream.once("error", cleanup);
    return new Response(Readable.toWeb(stream) as unknown as BodyInit, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archive.filename)}`,
      },
    });
  } catch (error) {
    return competitionError(error);
  }
}
