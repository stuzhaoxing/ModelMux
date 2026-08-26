import { describe, expect, it } from "vitest";

import type { JudgeQuestion } from "./types";
import {
  buildJudgeDashboardSummary,
  formatJudgeCountdown,
} from "./judge-dashboard";

function makeQuestion(
  id: number,
  status: JudgeQuestion["status"],
  progress: JudgeQuestion["progress"],
): JudgeQuestion {
  return {
    id,
    title: `题目 ${id}`,
    contentHtml: "<p>内容</p>",
    status,
    version: 1,
    createdAt: "2026-08-25T08:00:00.000Z",
    updatedAt: "2026-08-25T08:00:00.000Z",
    publishedAt: status === "draft" ? null : "2026-08-25T08:00:00.000Z",
    closedAt: status === "closed" ? "2026-08-25T09:00:00.000Z" : null,
    authorName: "评委",
    progress,
  };
}

describe("judge dashboard summary", () => {
  it("summarizes question states and answer slots across released questions", () => {
    const summary = buildJudgeDashboardSummary([
      makeQuestion(1, "draft", { total: 6, submitted: 0, drafting: 0, notStarted: 6 }),
      makeQuestion(2, "published", { total: 6, submitted: 3, drafting: 2, notStarted: 1 }),
      makeQuestion(3, "closed", { total: 6, submitted: 5, drafting: 0, notStarted: 1 }),
    ]);

    expect(summary.questions).toEqual({ total: 3, draft: 1, published: 1, closed: 1 });
    expect(summary.answers).toEqual({
      questionCount: 2,
      total: 12,
      submitted: 8,
      drafting: 2,
      notStarted: 2,
      submissionRate: 67,
    });
  });

  it("returns a zero rate when no released question has contestants", () => {
    const summary = buildJudgeDashboardSummary([
      makeQuestion(1, "published", { total: 0, submitted: 0, drafting: 0, notStarted: 0 }),
    ]);

    expect(summary.answers.submissionRate).toBe(0);
  });

  it("formats live countdown values", () => {
    expect(formatJudgeCountdown(4_470)).toBe("01:14:30");
    expect(formatJudgeCountdown(0)).toBe("00:00:00");
    expect(formatJudgeCountdown(null)).toBe("--:--:--");
  });
});
