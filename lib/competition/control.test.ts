import { describe, expect, it } from "vitest";

import {
  competitionAllowsQuestionManagement,
  competitionAllowsAnswers,
  competitionControlFromStored,
  competitionRemainingSeconds,
} from "./control";

describe("competition control", () => {
  it("derives not-started, running and naturally-ended states", () => {
    expect(competitionControlFromStored({
      status: "not_started",
      durationMinutes: 90,
      startedAt: null,
      endsAt: null,
      stoppedAt: null,
    }, 0).state).toBe("not_started");

    const running = competitionControlFromStored({
      status: "running",
      durationMinutes: 60,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T09:00:00.000Z",
      stoppedAt: null,
    }, Date.parse("2026-08-25T08:15:00.000Z"));
    expect(running.state).toBe("running");
    expect(competitionRemainingSeconds(running, Date.parse("2026-08-25T08:15:00.000Z"))).toBe(2_700);

    expect(competitionControlFromStored({
      status: "running",
      durationMinutes: 60,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T09:00:00.000Z",
      stoppedAt: null,
    }, Date.parse("2026-08-25T09:00:00.000Z")).state).toBe("ended");
  });

  it("treats a manually stopped run as ended and preserves timestamps", () => {
    expect(competitionControlFromStored({
      status: "ended",
      durationMinutes: "45",
      startedAt: "2026-08-25 16:00:00.000",
      endsAt: "2026-08-25 16:20:00.000",
      stoppedAt: "2026-08-25 16:20:00.000",
    }, Date.parse("2026-08-25T08:20:00.000Z"))).toEqual({
      phase: "competition",
      state: "ended",
      durationMinutes: 45,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T08:20:00.000Z",
      stoppedAt: "2026-08-25T08:20:00.000Z",
    });
  });

  it.each(["not_started", "running", "ended"] as const)("normalizes legacy %s tests to unlimited pre-competition testing", (status) => {
    const control = competitionControlFromStored({
      phase: "test", status, durationMinutes: 20,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T08:20:00.000Z",
      stoppedAt: "2026-08-25T08:10:00.000Z",
    }, Date.parse("2026-09-09T08:00:00.000Z"));
    expect(control).toMatchObject({ phase: "test", state: "not_started", startedAt: null, endsAt: null, stoppedAt: null });
    expect(competitionAllowsAnswers(control)).toBe(true);
    expect(competitionAllowsQuestionManagement(control.state)).toBe(true);
    expect(competitionRemainingSeconds(control)).toBe(0);
  });

  it("allows question management before start and after stop only", () => {
    expect(competitionAllowsQuestionManagement("not_started")).toBe(true);
    expect(competitionAllowsQuestionManagement("running")).toBe(false);
    expect(competitionAllowsQuestionManagement("ended")).toBe(true);
  });
});
