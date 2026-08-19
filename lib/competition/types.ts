import type { OperationMode } from "@/lib/gateway/operation-mode";

export type CompetitionRole = "judge" | "contestant";
export type QuestionStatus = "draft" | "published" | "closed";
export type AnswerStatus = "not_started" | "draft" | "submitted";

export interface CompetitionUser {
  id: number;
  role: CompetitionRole;
  username: string;
  displayName: string;
  password: string | null;
  apiKey: string | null;
  requestQuota: number;
  requestsUsed: number;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface ContestantApiAccess {
  apiBase: string;
  anthropicApiBase: string;
  apiKey: string;
  requestQuota: number;
  requestsUsed: number;
  requestsRemaining: number;
  // 比赛模式下 quotaEnforced 为 false，总额度不再拦截调用，
  // requestQuota / requestsRemaining 只作为测试模式的参考值保留。
  operationMode: OperationMode;
  quotaEnforced: boolean;
  rateLimitRpm: number;
  models: Array<{
    id: string;
    name: string;
    description: string;
    compatibilityAliases: string[];
    inputModalities: Array<"text" | "image" | "video">;
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
  | "question-published"
  | "question-closed"
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
