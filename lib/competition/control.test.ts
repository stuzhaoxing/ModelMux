import { describe, expect, it } from "vitest";

import {
  competitionAllowsQuestionManagement,
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
      state: "ended",
      durationMinutes: 45,
      startedAt: "2026-08-25T08:00:00.000Z",
      endsAt: "2026-08-25T08:20:00.000Z",
      stoppedAt: "2026-08-25T08:20:00.000Z",
    });
  });

  it("allows question management before start and after stop only", () => {
    expect(competitionAllowsQuestionManagement("not_started")).toBe(true);
    expect(competitionAllowsQuestionManagement("running")).toBe(false);
    expect(competitionAllowsQuestionManagement("ended")).toBe(true);
  });
});
