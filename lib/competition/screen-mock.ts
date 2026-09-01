import {
  competitionMockTokenMinute,
  competitionScreenContestantStatus,
  competitionScreenDisplayStatus,
  type CompetitionScreenContestant,
  type CompetitionScreenSnapshot,
} from "./screen-model";
import { getCompetitionScreenSnapshot } from "./screen";

export const competitionScreenMockTotalMinutes = 90;
export const competitionScreenMockRealMsPerMinute = 3_000;
export const competitionScreenMockQuestionTotal = 5;

export function competitionScreenMockEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.MODELMUX_DEPLOYMENT_MODE === "local"
    || env.MODELMUX_ENABLE_SCREEN_MOCK === "true";
}

declare global {
  var __modelmuxCompetitionScreenMockStartedAt: number | undefined;
}

export function startCompetitionScreenMock(now = Date.now()): number {
  globalThis.__modelmuxCompetitionScreenMockStartedAt = now;
  return now;
}

export function buildCompetitionScreenMockSnapshot(
  base: CompetitionScreenSnapshot,
  startedAt: number,
  now: number,
): CompetitionScreenSnapshot {
  const elapsedMinutes = Math.min(
    competitionScreenMockTotalMinutes,
    Math.max(0, Math.floor((now - startedAt) / competitionScreenMockRealMsPerMinute)),
  );
  const finished = elapsedMinutes >= competitionScreenMockTotalMinutes;
  const questionTotal = competitionScreenMockQuestionTotal;
  const workPlans = base.contestants.map((_, index) => ({
    startsAt: index % 9,
    finishesAt: index % 7 === 0
      ? 96 + (index % 3) * 4
      : 62 + ((index * 7) % 25),
  }));
  const tokenMinutes = Array<number>(competitionScreenMockTotalMinutes).fill(0);
  for (let minute = 0; minute < elapsedMinutes; minute += 1) {
    tokenMinutes[minute] = competitionMockTokenMinute(minute);
  }
  const totalTokens = tokenMinutes.reduce((sum, value) => sum + value, 0);
  const contestants: CompetitionScreenContestant[] = base.contestants.map((contestant, index) => {
    const workStartsAt = workPlans[index].startsAt;
    const workFinishesAt = workPlans[index].finishesAt;
    const progress = elapsedMinutes < workStartsAt
      ? 0
      : Math.min(1, (elapsedMinutes - workStartsAt) / (workFinishesAt - workStartsAt));
    const submitted = progress >= 1
      ? questionTotal
      : Math.min(questionTotal, Math.floor(progress * questionTotal));
    const drafting = elapsedMinutes > workStartsAt && submitted < questionTotal ? 1 : 0;
    const progressStatus = competitionScreenContestantStatus({ questionTotal, submitted, drafting });
    const status = competitionScreenDisplayStatus({
      status: progressStatus,
      stage: finished ? "finished" : "live",
      questionTotal,
    });
    return {
      ...contestant,
      status,
      submitted,
      drafting,
      notStarted: Math.max(0, questionTotal - submitted - drafting),
      lastActivityAt: elapsedMinutes > workStartsAt ? new Date(now).toISOString() : null,
      durationSeconds: status === "submitted"
        ? workFinishesAt * 60
        : status === "unfinished"
          ? competitionScreenMockTotalMinutes * 60
          : null,
      durationKind: status === "submitted"
        ? "completed"
        : status === "unfinished"
          ? "timeout"
          : null,
    };
  });
  const fullySubmitted = contestants.filter((item) => item.status === "submitted").length;
  const unfinished = contestants.filter((item) => item.status === "unfinished").length;
  const drafting = contestants.filter((item) => item.status === "drafting").length;
  const notStarted = contestants.filter((item) => item.status === "not_started").length;

  return {
    ...base,
    generatedAt: new Date(now).toISOString(),
    mode: "competition",
    stage: finished ? "finished" : "live",
    schedule: {
      configured: true,
      startAt: new Date(startedAt).toISOString(),
      endAt: new Date(startedAt + competitionScreenMockTotalMinutes * competitionScreenMockRealMsPerMinute).toISOString(),
    },
    summary: {
      ...base.summary,
      questionTotal,
      publishedQuestions: questionTotal,
      closedQuestions: finished ? questionTotal : 0,
      fullySubmitted,
      unfinished,
      drafting,
      notStarted,
      totalTokens,
    },
    tokenMinutes,
    contestants,
    simulation: {
      startedAt: new Date(startedAt).toISOString(),
      elapsedMinutes,
      totalMinutes: competitionScreenMockTotalMinutes,
      realMsPerMinute: competitionScreenMockRealMsPerMinute,
    },
  };
}

export async function getCompetitionScreenMockSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
  requestedStartedAt?: number,
): Promise<CompetitionScreenSnapshot> {
  const startedAt = requestedStartedAt
    ?? globalThis.__modelmuxCompetitionScreenMockStartedAt
    ?? startCompetitionScreenMock(now);
  return buildCompetitionScreenMockSnapshot(
    await getCompetitionScreenSnapshot(env, now),
    startedAt,
    now,
  );
}
