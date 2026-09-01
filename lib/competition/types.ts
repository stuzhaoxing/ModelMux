import type {
  ModelFamily,
  ModelInputModality,
} from "@/lib/gateway/types";

export type CompetitionRole = "judge" | "contestant";
export type QuestionStatus = "draft" | "published" | "closed";
export type AnswerStatus = "not_started" | "draft" | "submitted";
export type CompetitionControlState = "not_started" | "running" | "ended";

export interface CompetitionControl {
  state: CompetitionControlState;
  durationMinutes: number;
  startedAt: string | null;
  endsAt: string | null;
  stoppedAt: string | null;
}

export interface CompetitionScreenNotice {
  title: string;
  content: string;
  enabled: boolean;
  updatedAt: string | null;
}

export interface CompetitionUser {
  id: number;
  role: CompetitionRole;
  username: string;
  displayName: string;
  password: string | null;
  apiKey: string | null;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ContestantApiAccess {
  apiBase: string;
  apiKey: string;
  models: Array<{
    id: string;
    name: string;
    description: string;
    family: ModelFamily;
    inputModalities: ModelInputModality[];
    contextWindowTokens: number | null;
  }>;
}

export interface SessionUser {
  id: number;
  role: CompetitionRole;
  username: string;
  displayName: string;
}

export interface CompetitionQuestion {
  id: number;
  title: string;
  contentHtml: string;
  status: QuestionStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  closedAt: string | null;
  authorName: string;
}

export interface QuestionAnswerProgress {
  total: number;
  submitted: number;
  drafting: number;
  notStarted: number;
}

export interface JudgeQuestion extends CompetitionQuestion {
  progress: QuestionAnswerProgress;
}

export interface ContestantAnswer {
  id: number | null;
  questionId: number;
  contentHtml: string;
  status: AnswerStatus;
  firstSavedAt: string | null;
  updatedAt: string | null;
  submittedAt: string | null;
}

export interface JudgeAnswerRow extends ContestantAnswer {
  contestantId: number;
  contestantName: string;
  username: string;
}

export type ActivityCategory = "auth" | "answer" | "question" | "model";
export type ActivityOutcome = "ok" | "warn" | "error";

export type ActivityAction =
  | "login"
  | "logout"
  | "answer-started"
  | "answer-saved"
  | "answer-submitted"
  | "question-created"
  | "question-updated"
  | "question-deleted"
  | "question-published"
  | "question-closed"
  | "competition-started"
  | "competition-stopped"
  | "model-call"
  | "model-rejected";

export interface ActivityEntry {
  id: number;
  category: ActivityCategory;
  action: ActivityAction;
  actorRole: CompetitionRole;
  actorId: number | null;
  actorUsername: string;
  actorName: string;
  questionId: number | null;
  questionTitle: string | null;
  detail: string | null;
  outcome: ActivityOutcome;
  at: string;
}

export interface CompetitionEvent {
  type: "question-updated" | "answer-updated";
  questionId: number;
  at: string;
}
