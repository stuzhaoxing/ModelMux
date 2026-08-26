import type { OperationMode } from "@/lib/gateway/operation-mode";
import type { CompetitionControl, CompetitionControlState } from "./types";

export type CompetitionScreenStage =
  | "setup"
  | "scheduled"
  | "rehearsal"
  | "live"
  | "finished";

export type CompetitionScreenContestantStatus =
  | "waiting"
  | "not_started"
  | "drafting"
  | "submitted"
  | "unfinished";

export type CompetitionScreenDurationKind = "completed" | "timeout";

export interface CompetitionScreenSchedule {
  configured: boolean;
  startAt: string | null;
  endAt: string | null;
}

export interface CompetitionScreenContestant {
  id: number;
  name: string;
  status: CompetitionScreenContestantStatus;
  submitted: number;
  drafting: number;
  notStarted: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokenMinutes: number[];
  lastActivityAt: string | null;
  durationSeconds: number | null;
  durationKind: CompetitionScreenDurationKind | null;
}

export interface CompetitionScreenSummary {
  contestantTotal: number;
  questionTotal: number;
  publishedQuestions: number;
  closedQuestions: number;
  fullySubmitted: number;
  unfinished: number;
  drafting: number;
  notStarted: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface CompetitionScreenSnapshot {
  generatedAt: string;
  mode: OperationMode;
  stage: CompetitionScreenStage;
  schedule: CompetitionScreenSchedule;
  competition: CompetitionControl;
  summary: CompetitionScreenSummary;
  tokenMinutes: number[];
  contestants: CompetitionScreenContestant[];
  simulation: CompetitionScreenSimulation | null;
}

export interface CompetitionScreenSimulation {
  startedAt: string;
  elapsedMinutes: number;
  totalMinutes: number;
  realMsPerMinute: number;
}

export interface CompetitionScreenGrid {
  columns: number;
  rows: number;
}

export const defaultCompetitionDurationMinutes = 90;

export interface CompetitionScreenProgressChange {
  id: number;
  index: number;
  before: CompetitionScreenContestant;
  after: CompetitionScreenContestant;
  questionTotal: number;
}

const contestantNameCollator = new Intl.Collator("zh-CN-u-co-pinyin", {
  sensitivity: "base",
  usage: "sort",
});

export function competitionScreenContestantsByPinyin<
  T extends Pick<CompetitionScreenContestant, "id" | "name">,
>(contestants: readonly T[]): T[] {
  return [...contestants].sort((left, right) => (
    contestantNameCollator.compare(left.name.trim(), right.name.trim())
    || left.id - right.id
  ));
}

function parsedIsoTime(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

export function parseCompetitionSchedule(
  startValue: string | undefined,
  endValue: string | undefined,
): CompetitionScreenSchedule {
  const startAt = parsedIsoTime(startValue);
  const endAt = parsedIsoTime(endValue);
  return {
    configured: Boolean(
      startAt && endAt && Date.parse(endAt) > Date.parse(startAt),
    ),
    startAt,
    endAt,
  };
}

interface CompetitionCountdownEnv {
  MODELMUX_COMPETITION_DURATION_MINUTES?: string;
  MODELMUX_COMPETITION_START_AT?: string;
  MODELMUX_COMPETITION_END_AT?: string;
}

export function competitionCountdownMinutes(env: NodeJS.ProcessEnv | CompetitionCountdownEnv = process.env): number {
  const values = env as CompetitionCountdownEnv;
  const configured = Number(values.MODELMUX_COMPETITION_DURATION_MINUTES?.trim());
  if (Number.isSafeInteger(configured) && configured >= 1 && configured <= 24 * 60) return configured;
  const legacySchedule = parseCompetitionSchedule(
    values.MODELMUX_COMPETITION_START_AT,
    values.MODELMUX_COMPETITION_END_AT,
  );
  if (legacySchedule.configured && legacySchedule.startAt && legacySchedule.endAt) {
    return Math.max(1, Math.round((Date.parse(legacySchedule.endAt) - Date.parse(legacySchedule.startAt)) / 60_000));
  }
  return defaultCompetitionDurationMinutes;
}

export function competitionScreenScheduleFromStart(
  startedAt: number | null,
  durationMinutes: number,
): CompetitionScreenSchedule {
  if (startedAt === null || !Number.isFinite(startedAt)) {
    return { configured: false, startAt: null, endAt: null };
  }
  const minutes = Number.isSafeInteger(durationMinutes) && durationMinutes > 0
    ? durationMinutes
    : defaultCompetitionDurationMinutes;
  return {
    configured: true,
    startAt: new Date(startedAt).toISOString(),
    endAt: new Date(startedAt + minutes * 60_000).toISOString(),
  };
}

export function competitionScreenStageAt(input: {
  schedule: CompetitionScreenSchedule;
  mode: OperationMode;
  questionTotal: number;
  publishedQuestions: number;
  closedQuestions: number;
  competitionState?: CompetitionControlState;
  now: number;
}): CompetitionScreenStage {
  if (input.competitionState === "not_started") return "setup";
  if (input.competitionState === "ended") return "finished";
  if (input.competitionState === "running") {
    if (input.schedule.configured && input.schedule.endAt && input.now >= Date.parse(input.schedule.endAt)) return "finished";
    return input.mode === "competition" ? "live" : "rehearsal";
  }
  if (input.questionTotal > 0 && input.closedQuestions === input.questionTotal) {
    return "finished";
  }
  if (input.schedule.configured && input.schedule.startAt && input.schedule.endAt) {
    if (input.now < Date.parse(input.schedule.startAt)) return "scheduled";
    if (input.now >= Date.parse(input.schedule.endAt)) return "finished";
    return input.mode === "competition" ? "live" : "rehearsal";
  }
  if (input.publishedQuestions > 0) {
    return input.mode === "competition" ? "live" : "rehearsal";
  }
  return "setup";
}

export function competitionScreenContestantStatus(input: {
  questionTotal: number;
  submitted: number;
  drafting: number;
}): CompetitionScreenContestantStatus {
  if (input.questionTotal === 0) return "waiting";
  if (input.submitted >= input.questionTotal) return "submitted";
  if (input.submitted > 0 || input.drafting > 0) return "drafting";
  return "not_started";
}

export function competitionScreenProgressCount(
  contestant: Pick<CompetitionScreenContestant, "submitted" | "drafting">,
  questionTotal: number,
): number {
  if (questionTotal <= 0) return 0;
  return Math.min(questionTotal, Math.max(0, contestant.submitted + contestant.drafting));
}

export function competitionScreenDisplayStatus(input: {
  status: CompetitionScreenContestantStatus;
  stage: CompetitionScreenStage;
  questionTotal: number;
}): CompetitionScreenContestantStatus {
  if (input.stage === "finished" && input.questionTotal > 0 && input.status !== "submitted") {
    return "unfinished";
  }
  return input.status;
}

export function competitionScreenDuration(input: {
  status: CompetitionScreenContestantStatus;
  startedAt: number | null;
  completedAt: number | null;
  eventEndedAt: number | null;
}): { seconds: number; kind: CompetitionScreenDurationKind } | null {
  if (input.startedAt === null) return null;
  const kind = input.status === "submitted"
    ? "completed"
    : input.status === "unfinished"
      ? "timeout"
      : null;
  if (!kind) return null;
  const stoppedAt = kind === "completed"
    ? input.completedAt === null
      ? null
      : Math.min(input.completedAt, input.eventEndedAt ?? input.completedAt)
    : input.eventEndedAt;
  if (stoppedAt === null || stoppedAt < input.startedAt) return null;
  return {
    seconds: Math.floor((stoppedAt - input.startedAt) / 1_000),
    kind,
  };
}

export function competitionScreenGrid(contestantTotal: number): CompetitionScreenGrid {
  const total = Number.isSafeInteger(contestantTotal) && contestantTotal > 0
    ? contestantTotal
    : 0;
  if (total === 0) return { columns: 4, rows: 2 };
  const columns = Math.max(4, Math.ceil(Math.sqrt(total * 1.2)));
  return {
    columns,
    rows: Math.ceil(total / columns),
  };
}

export function competitionScreenProgressChanges(
  previous: CompetitionScreenSnapshot | null,
  next: CompetitionScreenSnapshot,
): CompetitionScreenProgressChange[] {
  if (!previous) return [];
  const previousById = new Map(previous.contestants.map((contestant) => [contestant.id, contestant]));
  return competitionScreenContestantsByPinyin(next.contestants).flatMap((contestant, index) => {
    const before = previousById.get(contestant.id);
    if (!before) return [];
    const changed = competitionScreenProgressCount(before, next.summary.questionTotal)
      !== competitionScreenProgressCount(contestant, next.summary.questionTotal)
      || before.status !== contestant.status;
    return changed ? [{
      id: contestant.id,
      index,
      before,
      after: contestant,
      questionTotal: next.summary.questionTotal,
    }] : [];
  });
}

export function competitionScreenTokenBarScales(input: {
  tokenMinutes: number[];
  maxMinuteTokens: number;
  count?: number;
}): number[] {
  const count = Math.max(1, Math.min(90, Math.floor(input.count ?? 90)));
  const recent = input.tokenMinutes.slice(-count);
  const padded = [...Array<number>(count - recent.length).fill(0), ...recent];
  return padded.map((value) => input.maxMinuteTokens > 0
    ? Math.max(0, Math.min(1, value / input.maxMinuteTokens))
    : 0);
}

export function competitionMockTokenMinute(tick: number): number {
  const safeTick = Number.isFinite(tick) ? Math.max(0, Math.floor(tick)) : 0;
  const wave = 46_000_000
    + Math.sin(safeTick * 0.72) * 18_000_000
    + Math.sin(safeTick * 0.21) * 9_500_000
    + (safeTick % 9 === 0 ? 22_000_000 : 0);
  return Math.max(6_000_000, Math.round(wave / 100_000) * 100_000);
}
