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
  const contestantTokenMinutes = base.contestants.map(() => Array<number>(competitionScreenMockTotalMinutes).fill(0));
  const tokenMinutes = Array<number>(competitionScreenMockTotalMinutes).fill(0);
  for (let minute = 0; minute < elapsedMinutes; minute += 1) {
    const activeIndexes = workPlans.flatMap((plan, index) => (
      minute >= plan.startsAt && minute < plan.finishesAt ? [index] : []
    ));
    if (activeIndexes.length === 0) continue;
    const minuteTotal = competitionMockTokenMinute(minute);
    const weights = activeIndexes.map((index) => 1 + ((index + minute) % 5) * .15);
    const weightTotal = weights.reduce((sum, value) => sum + value, 0);
    let allocated = 0;
    activeIndexes.forEach((contestantIndex, activeIndex) => {
      const share = activeIndex === activeIndexes.length - 1
        ? minuteTotal - allocated
        : Math.floor((minuteTotal * weights[activeIndex]) / weightTotal);
      contestantTokenMinutes[contestantIndex][minute] = share;
      allocated += share;
    });
    tokenMinutes[minute] = allocated;
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
    const requestCount = elapsedMinutes <= workStartsAt
      ? 0
      : Math.floor((elapsedMinutes - workStartsAt) * (1 + (index % 4) * .35));
    const minuteTokens = contestantTokenMinutes[index];
    const contestantTokens = minuteTokens.reduce((sum, value) => sum + value, 0);
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
      requestCount,
      inputTokens: Math.floor(contestantTokens * .68),
      outputTokens: contestantTokens - Math.floor(contestantTokens * .68),
      totalTokens: contestantTokens,
      tokenMinutes: minuteTokens,
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
      requestCount: contestants.reduce((sum, item) => sum + item.requestCount, 0),
      inputTokens: Math.floor(totalTokens * .68),
      outputTokens: totalTokens - Math.floor(totalTokens * .68),
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
