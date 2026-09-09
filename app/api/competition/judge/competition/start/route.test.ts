import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireJudgeOperator: vi.fn(),
  requireSameOrigin: vi.fn(),
  startCompetition: vi.fn(),
  listJudgeQuestions: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock("@/lib/competition/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/competition/http")>(),
  requireJudgeOperator: mocks.requireJudgeOperator,
  requireSameOrigin: mocks.requireSameOrigin,
}));

vi.mock("@/lib/competition/repository", () => ({
  startCompetition: mocks.startCompetition,
  listJudgeQuestions: mocks.listJudgeQuestions,
}));

vi.mock("@/lib/competition/activity", () => ({
  recordActivity: mocks.recordActivity,
}));


import { POST } from "./route";

describe("competition start duration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requireJudgeOperator.mockReturnValue({
      id: null,
      role: "judge",
      username: "admin",
      displayName: "管理员",
    });
    mocks.startCompetition.mockResolvedValue({
      competition: {
        state: "running",
        durationMinutes: 144000,
        startedAt: "2026-08-28T08:00:00.000Z",
        endsAt: "2026-12-06T08:00:00.000Z",
        stoppedAt: null,
      },
      questionCount: 1,
    });
    mocks.listJudgeQuestions.mockResolvedValue([]);
  });

  it("accepts a positive integer above the former 1440 minute limit", async () => {
    const response = await POST(new NextRequest(
      "http://localhost/api/competition/judge/competition/start",
      {
        method: "POST",
        body: JSON.stringify({ durationMinutes: 144000 }),
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.startCompetition).toHaveBeenCalledWith(144000);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      detail: "开始正式比赛，开放 1 道题目，限时 144000 分钟",
    }));
  });

  it("still rejects zero and non-integer durations", async () => {
    for (const durationMinutes of [0, 1.5]) {
      const response = await POST(new NextRequest(
        "http://localhost/api/competition/judge/competition/start",
        {
          method: "POST",
          body: JSON.stringify({ durationMinutes }),
        },
      ));
      expect(response.status).toBe(400);
    }
    expect(mocks.startCompetition).not.toHaveBeenCalled();
  });

  it("returns an actionable conflict when an ended competition has not been reset", async () => {
    mocks.startCompetition.mockRejectedValueOnce(new Error("competition_reset_required"));
    const response = await POST(new NextRequest("http://localhost/api/competition/judge/competition/start", {
      method: "POST", body: JSON.stringify({ durationMinutes: 90 }),
    }));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "比赛已结束，请先归档并重置回到测试状态，再开始下一场比赛" });
    expect(mocks.listJudgeQuestions).not.toHaveBeenCalled();
    expect(mocks.recordActivity).not.toHaveBeenCalled();
  });

  it("rejects the removed timed test start", async () => {
    const response = await POST(new NextRequest("http://localhost/api/competition/judge/competition/start", {
      method: "POST", body: JSON.stringify({ durationMinutes: 20, phase: "test" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.startCompetition).not.toHaveBeenCalled();
  });

  it("rejects an unknown phase before starting", async () => {
    const response = await POST(new NextRequest("http://localhost/api/competition/judge/competition/start", {
      method: "POST", body: JSON.stringify({ durationMinutes: 20, phase: "preview" }),
    }));
    expect(response.status).toBe(400);
    expect(mocks.startCompetition).not.toHaveBeenCalled();
  });
});
