import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { activityAfter, latestActivityId } from "@/lib/competition/activity";
import { coalesceCompetitionEvents, competitionEventsAfter, latestCompetitionEventId } from "@/lib/competition/events";
import { competitionError, requireRole } from "@/lib/competition/http";
import type { CompetitionRole } from "@/lib/competition/types";
import { operationModeState } from "@/lib/gateway/operation-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Every connected client polls the database on its own timer, so this interval
// trades event latency against database load. It doubles as the SSE keepalive,
// which is why it stays well under any proxy idle timeout.
const DEFAULT_POLL_INTERVAL_MS = 3000;
const MIN_POLL_INTERVAL_MS = 500;
const MAX_POLL_INTERVAL_MS = 15000;

function pollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env.MODELMUX_EVENT_POLL_MS?.trim() ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POLL_INTERVAL_MS;
  return Math.min(Math.max(parsed, MIN_POLL_INTERVAL_MS), MAX_POLL_INTERVAL_MS);
}

export async function GET(request: NextRequest): Promise<Response> {
  const value = request.nextUrl.searchParams.get("role");
  const role: CompetitionRole | null = value === "judge" || value === "contestant" ? value : null;
  if (!role) return NextResponse.json({ error: "实时通道角色无效" }, { status: 400 });
  const user = await requireRole(request, role);
  if (user instanceof NextResponse) return user;
  try {
    let cursor = await latestCompetitionEventId();
    // Judges get the live 现场日志 on the same channel; contestants never do.
    let activityCursor = role === "judge" ? await latestActivityId() : 0;
    // 测试/比赛模式必须在两个端上同步显眼地切换，所以复用这条已有的实时通道。
    let mode = (await operationModeState()).mode;
    const encoder = new TextEncoder();
    const interval = pollIntervalMs();
    let connected = false;
    let degraded = false;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (!connected) {
          connected = true;
          controller.enqueue(
            encoder.encode(
              `event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString(), mode })}\n\n`,
            ),
          );
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, interval));
        if (cancelled) return;
        try {
          const currentMode = (await operationModeState()).mode;
          if (currentMode !== mode) {
            mode = currentMode;
            controller.enqueue(
              encoder.encode(
                `event: mode\ndata: ${JSON.stringify({ mode, at: new Date().toISOString() })}\n\n`,
              ),
            );
          }
          if (role === "judge") {
            const entries = await activityAfter(activityCursor, 40);
            if (entries.length > 0) {
              activityCursor = entries.at(-1)?.id ?? activityCursor;
              controller.enqueue(encoder.encode(`event: activity\ndata: ${JSON.stringify(entries)}\n\n`));
            }
          }
          const events = await competitionEventsAfter(cursor);
          if (degraded) {
            degraded = false;
            controller.enqueue(
              encoder.encode(
                `event: connected\ndata: ${JSON.stringify({ at: new Date().toISOString(), mode })}\n\n`,
              ),
            );
          }
          if (events.length === 0) {
            controller.enqueue(encoder.encode(`: poll ${Date.now()}\n\n`));
            return;
          }
          cursor = events.at(-1)?.id ?? cursor;
          for (const event of coalesceCompetitionEvents(events)) {
            controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
          }
        } catch {
          if (!degraded) {
            degraded = true;
            controller.enqueue(encoder.encode(`event: degraded\ndata: {"at":"${new Date().toISOString()}"}\n\n`));
          } else {
            controller.enqueue(encoder.encode(": database retry\n\n"));
          }
        }
      },
      cancel() {
        cancelled = true;
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return competitionError(error);
  }
}
