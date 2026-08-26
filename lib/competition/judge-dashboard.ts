import type { JudgeQuestion } from "./types";

export interface JudgeDashboardSummary {
  questions: {
    total: number;
    draft: number;
    published: number;
    closed: number;
  };
  answers: {
    questionCount: number;
    total: number;
    submitted: number;
    drafting: number;
    notStarted: number;
    submissionRate: number;
  };
}

export function formatJudgeCountdown(seconds: number | null): string {
  if (seconds === null) return "--:--:--";
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3_600);
  const minutes = Math.floor((safe % 3_600) / 60);
  const remainingSeconds = safe % 60;
  return [hours, minutes, remainingSeconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export function buildJudgeDashboardSummary(questions: JudgeQuestion[]): JudgeDashboardSummary {
  const answerableQuestions = questions.filter((question) => question.status !== "draft");
  const answers = answerableQuestions.reduce(
    (summary, question) => ({
      total: summary.total + question.progress.total,
      submitted: summary.submitted + question.progress.submitted,
      drafting: summary.drafting + question.progress.drafting,
      notStarted: summary.notStarted + question.progress.notStarted,
    }),
    { total: 0, submitted: 0, drafting: 0, notStarted: 0 },
  );

  return {
    questions: {
      total: questions.length,
      draft: questions.filter((question) => question.status === "draft").length,
      published: questions.filter((question) => question.status === "published").length,
      closed: questions.filter((question) => question.status === "closed").length,
    },
    answers: {
      questionCount: answerableQuestions.length,
      ...answers,
      submissionRate: answers.total === 0 ? 0 : Math.round((answers.submitted / answers.total) * 100),
    },
  };
}
