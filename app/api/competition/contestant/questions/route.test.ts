import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  getCompetitionControl: vi.fn(),
  listContestantQuestions: vi.fn(),
  listAnswersForContestant: vi.fn(),
}));

vi.mock("@/lib/competition/http", () => ({
  requireRole: mocks.requireRole,
  competitionError: (error: unknown) => Response.json({ error: String(error) }, { status: 500 }),
}));

vi.mock("@/lib/competition/repository", () => ({
  getCompetitionControl: mocks.getCompetitionControl,
  listContestantQuestions: mocks.listContestantQuestions,
  listAnswersForContestant: mocks.listAnswersForContestant,
}));

import { GET } from "./route";

describe("contestant question visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRole.mockResolvedValue({ id: 7, role: "contestant", username: "player07", displayName: "选手七" });
  });

  it("hides questions and answers after the formal competition stops", async () => {
    const competition = { state: "ended", durationMinutes: 90, startedAt: "2026-08-25T08:00:00.000Z", endsAt: "2026-08-25T08:20:00.000Z", stoppedAt: "2026-08-25T08:20:00.000Z" };
    mocks.getCompetitionControl.mockResolvedValue(competition);

    const response = await GET(new NextRequest("http://localhost/api/competition/contestant/questions"));

    expect(await response.json()).toEqual({ questions: [], answers: [], competition });
    expect(mocks.listContestantQuestions).not.toHaveBeenCalled();
    expect(mocks.listAnswersForContestant).not.toHaveBeenCalled();
  });

  it("returns the formal workspace while the competition is running", async () => {
    const competition = { state: "running", durationMinutes: 60, startedAt: "2026-08-25T08:00:00.000Z", endsAt: "2026-08-25T09:00:00.000Z", stoppedAt: null };
    const questions = [{ id: 1, title: "第一题" }];
    const answers = [{ id: 9, questionId: 1, status: "draft" }];
    mocks.getCompetitionControl.mockResolvedValue(competition);
    mocks.listContestantQuestions.mockResolvedValue(questions);
    mocks.listAnswersForContestant.mockResolvedValue(answers);

    const response = await GET(new NextRequest("http://localhost/api/competition/contestant/questions"));

    expect(await response.json()).toEqual({ questions, answers, competition });
  });

  it("opens only test questions before the formal competition starts", async () => {
    const competition = { phase: "test", state: "not_started", startedAt: null, endsAt: null };
    mocks.getCompetitionControl.mockResolvedValue(competition);
    mocks.listContestantQuestions.mockResolvedValue([{ id: 2, phase: "test", status: "published" }]);
    mocks.listAnswersForContestant.mockResolvedValue([{ questionId: 2, status: "draft" }]);
    const response = await GET(new NextRequest("http://localhost/api/competition/contestant/questions"));
    expect(await response.json()).toEqual({
      competition,
      questions: [{ id: 2, phase: "test", status: "published" }],
      answers: [{ questionId: 2, status: "draft" }],
    });
    expect(mocks.listContestantQuestions).toHaveBeenCalledWith("test");
    expect(mocks.listAnswersForContestant).toHaveBeenCalledWith(7, "test");
  });

  it.each(["test", "competition"])("scopes both questions and answers to the active %s phase", async (phase) => {
    mocks.getCompetitionControl.mockResolvedValue({ phase, state: "running" });
    mocks.listContestantQuestions.mockResolvedValue([]);
    mocks.listAnswersForContestant.mockResolvedValue([]);
    const response = await GET(new NextRequest("http://localhost/api/competition/contestant/questions"));
    expect(response.status).toBe(200);
    expect(mocks.listContestantQuestions).toHaveBeenCalledWith(phase);
    expect(mocks.listAnswersForContestant).toHaveBeenCalledWith(7, phase);
  });
});
