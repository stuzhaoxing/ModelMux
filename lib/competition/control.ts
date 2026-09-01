import type { CompetitionControl } from "./types";

export interface StoredCompetitionControl {
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
  const endsAt = timestamp(stored.endsAt);
  const running = stored.status === "running"
    && startedAt !== null
    && endsAt !== null
    && startedAt <= now
    && endsAt > now;
  return {
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
