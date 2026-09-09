import type { CompetitionControl, QuestionPhase } from "./types";

export function competitionModeFromControl(control: CompetitionControl): QuestionPhase {
  return control.startedAt && control.phase === "competition" ? "competition" : "test";
}

export function competitionIsTesting(control: CompetitionControl): boolean {
  return control.phase === "test" || control.state === "not_started";
}

export function competitionAllowsAnswers(control: CompetitionControl): boolean {
  return competitionIsTesting(control) || control.state === "running";
}

export interface StoredCompetitionControl {
  phase?: QuestionPhase;
  status: "not_started" | "running" | "ended";
  durationMinutes: number | string;
  startedAt: string | null;
  endsAt: string | null;
  stoppedAt: string | null;
}

function timestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isoTime(value: string | null): string | null {
  const parsed = timestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
}

export function competitionControlFromStored(
  stored: StoredCompetitionControl,
  now = Date.now(),
): CompetitionControl {
  const startedAt = timestamp(stored.startedAt);
  // Legacy timed tests are now the same unlimited pre-competition stage.
  if (stored.phase === "test" || startedAt === null) {
    return {
      phase: "test",
      state: "not_started",
      durationMinutes: stored.phase === "test" ? 90 : Math.max(1, Number(stored.durationMinutes) || 90),
      startedAt: null,
      endsAt: null,
      stoppedAt: null,
    };
  }
  const endsAt = timestamp(stored.endsAt);
  const running = stored.status === "running"
    && startedAt !== null
    && endsAt !== null
    && startedAt <= now
    && endsAt > now;
  return {
    phase: stored.phase ?? "competition",
    state: running ? "running" : startedAt === null ? "not_started" : "ended",
    durationMinutes: Math.max(1, Number(stored.durationMinutes) || 90),
    startedAt: isoTime(stored.startedAt),
    endsAt: isoTime(stored.endsAt),
    stoppedAt: isoTime(stored.stoppedAt),
  };
}

export function competitionRemainingSeconds(control: CompetitionControl, now = Date.now()): number {
  if (control.state !== "running" || !control.endsAt) return 0;
  return Math.max(0, Math.floor((Date.parse(control.endsAt) - now) / 1_000));
}

export function competitionAllowsQuestionManagement(
  state: CompetitionControl["state"],
): boolean {
  return state !== "running";
}
