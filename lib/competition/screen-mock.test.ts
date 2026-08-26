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
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  },
  tokenMinutes: Array<number>(90).fill(0),
  contestants: ["甲", "乙"].map((name) => ({
    id: name === "甲" ? 1 : 2,
    name,
    status: "not_started" as const,
    submitted: 0,
    drafting: 0,
    notStarted: 3,
    requestCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokenMinutes: Array<number>(90).fill(0),
    lastActivityAt: null,
    durationSeconds: null,
    durationKind: null,
  })),
  simulation: null,
};

describe("competition screen accelerated mock", () => {
  const startedAt = Date.parse("2026-08-21T01:00:00.000Z");

  it("starts contestant Token usage in the first simulated minute without revealing future bars", () => {
    const minuteOne = buildCompetitionScreenMockSnapshot(
      base,
      startedAt,
      startedAt + competitionScreenMockRealMsPerMinute,
    );
    expect(minuteOne.simulation?.elapsedMinutes).toBe(1);
    expect(minuteOne.summary.questionTotal).toBe(competitionScreenMockQuestionTotal);
    expect(minuteOne.summary.publishedQuestions).toBe(competitionScreenMockQuestionTotal);
    expect(minuteOne.tokenMinutes.filter((value) => value > 0)).toHaveLength(1);
    expect(minuteOne.contestants[0].tokenMinutes.filter((value) => value > 0)).toHaveLength(1);
    expect(minuteOne.contestants[0]).toMatchObject({ status: "drafting", drafting: 1, requestCount: 1 });
    expect(minuteOne.contestants[0].tokenMinutes.slice(1).every((value) => value === 0)).toBe(true);
    expect(minuteOne.contestants[1]).toMatchObject({ status: "not_started", drafting: 0, requestCount: 0 });
    expect(minuteOne.contestants[1].tokenMinutes.every((value) => value === 0)).toBe(true);
    expect(minuteOne.stage).toBe("live");
  });

  it("finishes after 270 real seconds with all 90 minute buckets complete", () => {
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
    expect(finished.tokenMinutes.every((value) => value > 0)).toBe(true);
    expect(finished.summary.totalTokens).toBe(finished.tokenMinutes.reduce((sum, value) => sum + value, 0));
    expect(finished.contestants.reduce((sum, contestant) => sum + contestant.totalTokens, 0)).toBe(finished.summary.totalTokens);
    expect(finished.tokenMinutes.every((value, minute) => (
      finished.contestants.reduce((sum, contestant) => sum + contestant.tokenMinutes[minute], 0) === value
    ))).toBe(true);
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
