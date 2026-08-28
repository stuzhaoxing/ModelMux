import { describe, expect, it } from "vitest";

import {
  competitionCountdownMinutes,
  competitionScreenContestantsByPinyin,
  competitionScreenContestantStatus,
  competitionScreenDisplayStatus,
  competitionScreenDuration,
  competitionScreenGrid,
  competitionScreenProgressChanges,
  competitionScreenProgressCount,
  competitionScreenScheduleFromStart,
  competitionScreenStageAt,
  parseCompetitionSchedule,
} from "./screen-model";

describe("competition screen model", () => {
  const schedule = parseCompetitionSchedule(
    "2026-08-21T09:00:00+08:00",
    "2026-08-21T11:30:00+08:00",
  );

  it("normalizes a configured competition schedule", () => {
    expect(schedule).toEqual({
      configured: true,
      startAt: "2026-08-21T01:00:00.000Z",
      endAt: "2026-08-21T03:30:00.000Z",
    });
    expect(parseCompetitionSchedule("invalid", "2026-08-21T11:30:00+08:00").configured).toBe(false);
  });

  it("derives the runtime countdown duration and schedule from batch publication", () => {
    expect(competitionCountdownMinutes({ MODELMUX_COMPETITION_DURATION_MINUTES: "120" })).toBe(120);
    expect(competitionCountdownMinutes({ MODELMUX_COMPETITION_DURATION_MINUTES: "144000" })).toBe(144000);
    expect(competitionCountdownMinutes({ MODELMUX_COMPETITION_DURATION_MINUTES: "0" })).toBe(90);
    expect(competitionCountdownMinutes({
      MODELMUX_COMPETITION_START_AT: "2026-08-21T09:00:00+08:00",
      MODELMUX_COMPETITION_END_AT: "2026-08-21T11:30:00+08:00",
    })).toBe(150);
    expect(competitionScreenScheduleFromStart(Date.parse("2026-08-25T08:00:00.000Z"), 90)).toEqual({
      configured: true,
      startAt: "2026-08-25T08:00:00.000Z",
      endAt: "2026-08-25T09:30:00.000Z",
    });
    expect(competitionScreenScheduleFromStart(null, 90)).toEqual({
      configured: false,
      startAt: null,
      endAt: null,
    });
  });

  it("derives scheduled, live and finished stages from wall-clock time", () => {
    const shared = {
      schedule,
      mode: "competition" as const,
      questionTotal: 1,
      publishedQuestions: 1,
      closedQuestions: 0,
    };
    expect(competitionScreenStageAt({ ...shared, now: Date.parse("2026-08-21T00:59:59Z") })).toBe("scheduled");
    expect(competitionScreenStageAt({ ...shared, now: Date.parse("2026-08-21T02:00:00Z") })).toBe("live");
    expect(competitionScreenStageAt({ ...shared, mode: "test", now: Date.parse("2026-08-21T02:00:00Z") })).toBe("rehearsal");
    expect(competitionScreenStageAt({ ...shared, now: Date.parse("2026-08-21T03:30:00Z") })).toBe("finished");
    expect(competitionScreenStageAt({ ...shared, publishedQuestions: 0, closedQuestions: 1, now: Date.parse("2026-08-21T02:00:00Z") })).toBe("finished");
  });

  it("falls back to question and operation state when no schedule is configured", () => {
    const noSchedule = parseCompetitionSchedule(undefined, undefined);
    expect(competitionScreenStageAt({ schedule: noSchedule, mode: "test", questionTotal: 2, publishedQuestions: 1, closedQuestions: 1, now: 0 })).toBe("rehearsal");
    expect(competitionScreenStageAt({ schedule: noSchedule, mode: "competition", questionTotal: 2, publishedQuestions: 1, closedQuestions: 1, now: 0 })).toBe("live");
    expect(competitionScreenStageAt({ schedule: noSchedule, mode: "competition", questionTotal: 2, publishedQuestions: 0, closedQuestions: 2, now: 0 })).toBe("finished");
  });

  it("classifies contestant progress without treating drafts as submissions", () => {
    expect(competitionScreenContestantStatus({ questionTotal: 0, submitted: 0, drafting: 0 })).toBe("waiting");
    expect(competitionScreenContestantStatus({ questionTotal: 2, submitted: 0, drafting: 0 })).toBe("not_started");
    expect(competitionScreenContestantStatus({ questionTotal: 2, submitted: 1, drafting: 1 })).toBe("drafting");
    expect(competitionScreenContestantStatus({ questionTotal: 2, submitted: 2, drafting: 0 })).toBe("submitted");
    expect(competitionScreenProgressCount({ submitted: 0, drafting: 1 }, 5)).toBe(1);
    expect(competitionScreenProgressCount({ submitted: 1, drafting: 1 }, 5)).toBe(2);
    expect(competitionScreenProgressCount({ submitted: 5, drafting: 1 }, 5)).toBe(5);
  });

  it("marks incomplete contestants unfinished only after a real question set ends", () => {
    expect(competitionScreenDisplayStatus({ status: "drafting", stage: "finished", questionTotal: 5 })).toBe("unfinished");
    expect(competitionScreenDisplayStatus({ status: "not_started", stage: "finished", questionTotal: 5 })).toBe("unfinished");
    expect(competitionScreenDisplayStatus({ status: "submitted", stage: "finished", questionTotal: 5 })).toBe("submitted");
    expect(competitionScreenDisplayStatus({ status: "waiting", stage: "finished", questionTotal: 0 })).toBe("waiting");
  });

  it("computes completed and timed-out durations with deadline capping", () => {
    expect(competitionScreenDuration({ status: "submitted", startedAt: 1_000, completedAt: 61_000, eventEndedAt: 91_000 }))
      .toEqual({ seconds: 60, kind: "completed" });
    expect(competitionScreenDuration({ status: "submitted", startedAt: 1_000, completedAt: 101_000, eventEndedAt: 91_000 }))
      .toEqual({ seconds: 90, kind: "completed" });
    expect(competitionScreenDuration({ status: "unfinished", startedAt: 1_000, completedAt: null, eventEndedAt: 91_000 }))
      .toEqual({ seconds: 90, kind: "timeout" });
    expect(competitionScreenDuration({ status: "drafting", startedAt: 1_000, completedAt: null, eventEndedAt: null })).toBeNull();
    expect(competitionScreenDuration({ status: "unfinished", startedAt: null, completedAt: null, eventEndedAt: 91_000 })).toBeNull();
    expect(competitionScreenDuration({ status: "unfinished", startedAt: 100_000, completedAt: null, eventEndedAt: 91_000 })).toBeNull();
  });

  it("fits every contestant into one adaptive screen grid", () => {
    expect(competitionScreenGrid(0)).toEqual({ columns: 4, rows: 2 });
    expect(competitionScreenGrid(8)).toEqual({ columns: 4, rows: 2 });
    expect(competitionScreenGrid(12)).toEqual({ columns: 4, rows: 3 });
    expect(competitionScreenGrid(20)).toEqual({ columns: 5, rows: 4 });
    expect(competitionScreenGrid(26)).toEqual({ columns: 6, rows: 5 });
    expect(competitionScreenGrid(40)).toEqual({ columns: 7, rows: 6 });
  });

  it("ranks contestants by the pinyin order of their names", () => {
    const contestants = [
      { id: 4, name: "张三" },
      { id: 3, name: "李四" },
      { id: 5, name: "阿布" },
      { id: 2, name: "王五" },
      { id: 1, name: "李四" },
    ];

    const ranked = competitionScreenContestantsByPinyin(contestants);

    expect(ranked.map((contestant) => `${contestant.name}-${contestant.id}`)).toEqual([
      "阿布-5",
      "李四-1",
      "李四-3",
      "王五-2",
      "张三-4",
    ]);
    expect(contestants[0]).toEqual({ id: 4, name: "张三" });
  });

  it("detects progress changes by stable contestant id and ignores activity-only updates", () => {
    const contestant = {
      id: 7,
      name: "甲",
      status: "drafting" as const,
      submitted: 1,
      drafting: 1,
      notStarted: 3,
      lastActivityAt: null as string | null,
      durationSeconds: null,
      durationKind: null,
    };
    const snapshot = (contestants: typeof contestant[]): import("./screen-model").CompetitionScreenSnapshot => ({
      generatedAt: "2026-08-21T01:00:00.000Z",
      mode: "competition",
      stage: "live",
      schedule: { configured: false, startAt: null, endAt: null },
      competition: { state: "running", durationMinutes: 90, startedAt: "2026-08-21T01:00:00.000Z", endsAt: "2026-08-21T02:30:00.000Z", stoppedAt: null },
      summary: { contestantTotal: contestants.length, questionTotal: 5, publishedQuestions: 5, closedQuestions: 0, fullySubmitted: 0, unfinished: 0, drafting: contestants.length, notStarted: 0 },
      contestants,
      simulation: null,
    });
    const activityOnly = { ...contestant, lastActivityAt: "2026-08-21T01:01:00.000Z" };
    expect(competitionScreenProgressChanges(snapshot([contestant]), snapshot([activityOnly]))).toEqual([]);
    const progressed = { ...activityOnly, submitted: 2 };
    const changes = competitionScreenProgressChanges(snapshot([contestant]), snapshot([progressed]));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 7, index: 0, questionTotal: 5 });
    const submittedSameQuestion = { ...contestant, submitted: 2, drafting: 0 };
    expect(competitionScreenProgressChanges(snapshot([contestant]), snapshot([submittedSameQuestion]))).toEqual([]);
  });
});
