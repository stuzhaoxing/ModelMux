import { describe, expect, it } from "vitest";

import type { CompetitionScreenSnapshot } from "./screen-model";
import {
  buildCompetitionScreenMockSnapshot,
  competitionScreenMockEnabled,
  competitionScreenMockQuestionTotal,
  competitionScreenMockRealMsPerMinute,
  competitionScreenMockTotalMinutes,
} from "./screen-mock";

const base: CompetitionScreenSnapshot = {
  generatedAt: "2026-08-21T01:00:00.000Z",
  mode: "test",
  stage: "rehearsal",
  schedule: { configured: false, startAt: null, endAt: null },
  competition: { state: "running", durationMinutes: 90, startedAt: "2026-08-21T01:00:00.000Z", endsAt: "2026-08-21T02:30:00.000Z", stoppedAt: null },
  summary: {
    contestantTotal: 2,
    questionTotal: 3,
    publishedQuestions: 2,
    closedQuestions: 0,
    fullySubmitted: 0,
    unfinished: 0,
    drafting: 0,
    notStarted: 2,
  },
  contestants: ["甲", "乙"].map((name) => ({
    id: name === "甲" ? 1 : 2,
    name,
    status: "not_started" as const,
    submitted: 0,
    drafting: 0,
    notStarted: 3,
    lastActivityAt: null,
    durationSeconds: null,
    durationKind: null,
  })),
  simulation: null,
};

describe("competition screen accelerated mock", () => {
  const startedAt = Date.parse("2026-08-21T01:00:00.000Z");

  it("starts contestant progress in the first simulated minute", () => {
    const minuteOne = buildCompetitionScreenMockSnapshot(
      base,
      startedAt,
      startedAt + competitionScreenMockRealMsPerMinute,
    );
    expect(minuteOne.simulation?.elapsedMinutes).toBe(1);
    expect(minuteOne.summary.questionTotal).toBe(competitionScreenMockQuestionTotal);
    expect(minuteOne.summary.publishedQuestions).toBe(competitionScreenMockQuestionTotal);
    expect(minuteOne.contestants[0]).toMatchObject({ status: "drafting", drafting: 1 });
    expect(minuteOne.contestants[1]).toMatchObject({ status: "not_started", drafting: 0 });
    expect(minuteOne.stage).toBe("live");
  });

  it("finishes after 270 real seconds with final contestant states", () => {
    const almostFinished = buildCompetitionScreenMockSnapshot(
      base,
      startedAt,
      startedAt + competitionScreenMockTotalMinutes * competitionScreenMockRealMsPerMinute - 1,
    );
    const finished = buildCompetitionScreenMockSnapshot(
      base,
      startedAt,
      startedAt + competitionScreenMockTotalMinutes * competitionScreenMockRealMsPerMinute,
    );
    expect(almostFinished.simulation?.elapsedMinutes).toBe(89);
    expect(almostFinished.stage).toBe("live");
    expect(finished.simulation?.elapsedMinutes).toBe(90);
    expect(finished.summary.fullySubmitted).toBe(1);
    expect(finished.summary.unfinished).toBe(1);
    expect(finished.summary.closedQuestions).toBe(competitionScreenMockQuestionTotal);
    expect(finished.contestants[0]).toMatchObject({
      status: "unfinished",
      submitted: 4,
      durationSeconds: 5_400,
      durationKind: "timeout",
    });
    expect(finished.contestants[1]).toMatchObject({
      status: "submitted",
      submitted: competitionScreenMockQuestionTotal,
      durationKind: "completed",
    });
    expect(finished.stage).toBe("finished");
  });
});

describe("competition screen mock access", () => {
  it("allows local mode and requires an explicit flag in public mode", () => {
    expect(competitionScreenMockEnabled({ NODE_ENV: "test", MODELMUX_DEPLOYMENT_MODE: "local" })).toBe(true);
    expect(competitionScreenMockEnabled({ NODE_ENV: "test", MODELMUX_DEPLOYMENT_MODE: "public" })).toBe(false);
    expect(competitionScreenMockEnabled({
      NODE_ENV: "test",
      MODELMUX_DEPLOYMENT_MODE: "public",
      MODELMUX_ENABLE_SCREEN_MOCK: "true",
    })).toBe(true);
  });
});
