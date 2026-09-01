import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: vi.fn(),
  operationModeState: vi.fn(),
  getCompetitionControl: vi.fn(),
  getCompetitionScreenNotice: vi.fn(),
}));

vi.mock("./db", () => ({ rows: mocks.rows }));
vi.mock("@/lib/gateway/operation-mode", () => ({
  operationModeState: mocks.operationModeState,
}));
vi.mock("./repository", () => ({
  getCompetitionControl: mocks.getCompetitionControl,
  getCompetitionScreenNotice: mocks.getCompetitionScreenNotice,
}));

import { getCompetitionScreenSnapshot } from "./screen";

describe("competition screen runtime countdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.operationModeState.mockResolvedValue({ mode: "competition" });
    mocks.getCompetitionScreenNotice.mockResolvedValue({
      title: "接口信息",
      content: "http://10.0.0.8:1444/v1",
      enabled: true,
      updatedAt: "2026-08-25 15:50:00.000",
    });
  });

  it("starts the screen countdown from the shared batch publication time", async () => {
    mocks.getCompetitionControl.mockResolvedValue({
      state: "running",
      durationMinutes: 90,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T09:30:00.000Z",
      stoppedAt: null,
    });
    mocks.rows
      .mockResolvedValueOnce([{
        question_total: 3,
        published_questions: 3,
        closed_questions: 0,
        competition_started_at: "2026-08-25 16:00:00.000",
        competition_ended_at: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total_tokens: 321 }])
      .mockResolvedValueOnce([{
        minute_at: "2026-08-25 16:14:00",
        total_tokens: 321,
      }]);

    const snapshot = await getCompetitionScreenSnapshot(
      { ...process.env, MODELMUX_COMPETITION_DURATION_MINUTES: "90" },
      Date.parse("2026-08-25T08:15:00.000Z"),
    );

    expect(snapshot.schedule).toEqual({
      configured: true,
      startAt: "2026-08-25T08:00:00.000Z",
      endAt: "2026-08-25T09:30:00.000Z",
    });
    expect(snapshot.stage).toBe("live");
    expect(snapshot.notice).toMatchObject({ title: "接口信息", enabled: true });
    expect(snapshot.summary).toMatchObject({
      questionTotal: 3,
      publishedQuestions: 3,
      closedQuestions: 0,
      totalTokens: 321,
    });
    expect(snapshot.tokenMinutes.at(-2)).toBe(321);
  });

  it("keeps the screen waiting until the question set is published", async () => {
    mocks.getCompetitionControl.mockResolvedValue({
      state: "not_started",
      durationMinutes: 90,
      startedAt: null,
      endsAt: null,
      stoppedAt: null,
    });
    mocks.rows
      .mockResolvedValueOnce([{
        question_total: 0,
        published_questions: 0,
        closed_questions: 0,
        competition_started_at: null,
        competition_ended_at: null,
      }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const snapshot = await getCompetitionScreenSnapshot(
      { ...process.env,
        MODELMUX_COMPETITION_DURATION_MINUTES: undefined,
        MODELMUX_COMPETITION_START_AT: "2026-08-25T16:00:00+08:00",
        MODELMUX_COMPETITION_END_AT: "2026-08-25T17:30:00+08:00",
      },
      Date.parse("2026-08-25T08:15:00.000Z"),
    );

    expect(snapshot.schedule.configured).toBe(false);
    expect(snapshot.stage).toBe("setup");
    expect(snapshot.notice.content).toBe("http://10.0.0.8:1444/v1");
  });
});
