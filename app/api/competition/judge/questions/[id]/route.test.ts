import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  deleteQuestionWhileStopped: vi.fn(),
  listJudgeQuestions: vi.fn(),
  getCompetitionControl: vi.fn(),
  recordActivity: vi.fn(),
}));

vi.mock("@/lib/competition/http", () => ({
  requireRole: mocks.requireRole,
  requireSameOrigin: mocks.requireSameOrigin,
  parseJson: vi.fn(),
  competitionError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));

vi.mock("@/lib/competition/repository", () => ({
  deleteQuestionWhileStopped: mocks.deleteQuestionWhileStopped,
  getCompetitionControl: mocks.getCompetitionControl,
  getQuestion: vi.fn(),
  listJudgeQuestions: mocks.listJudgeQuestions,
  updateQuestion: vi.fn(),
}));

vi.mock("@/lib/competition/activity", () => ({
  recordActivity: mocks.recordActivity,
}));

import { DELETE } from "./route";

describe("judge question deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requireRole.mockResolvedValue({
      id: 8,
      role: "judge",
      username: "judge08",
      displayName: "评委八",
    });
  });

  it("returns the remaining workspace and records the deleted answer count", async () => {
    const competition = {
      state: "ended",
      durationMinutes: 90,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T09:00:00.000Z",
      stoppedAt: "2026-08-25T09:00:00.000Z",
    };
    const questions = [{ id: 4, title: "保留题目" }];
    mocks.deleteQuestionWhileStopped.mockResolvedValue({ title: "删除题目", answerCount: 2 });
    mocks.listJudgeQuestions.mockResolvedValue(questions);
    mocks.getCompetitionControl.mockResolvedValue(competition);

    const response = await DELETE(
      new NextRequest("http://localhost/api/competition/judge/questions/3", { method: "DELETE" }),
      { params: Promise.resolve({ id: "3" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: { id: 3, title: "删除题目", answerCount: 2 },
      questions,
      competition,
    });
    expect(mocks.deleteQuestionWhileStopped).toHaveBeenCalledWith(3);
    expect(mocks.recordActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: "question-deleted",
      questionId: 3,
      questionTitle: "删除题目",
      detail: "同时删除 2 份已有答卷",
      outcome: "warn",
    }));
  });
});
