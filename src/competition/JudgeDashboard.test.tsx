import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { JudgeQuestion } from "@/lib/competition/types";
import { JudgeDashboard } from "./JudgeDashboard";

function question(id: number, status: JudgeQuestion["status"]): JudgeQuestion {
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
    progress: { total: 6, submitted: 0, drafting: 0, notStarted: 6 },
  };
}

describe("judge dashboard batch publishing", () => {
  it("asks for a duration before starting an unstarted competition", () => {
    const html = renderToStaticMarkup(
      <JudgeDashboard
        questions={[question(1, "draft"), question(2, "draft")]}
        loading={false}
        competition={{ state: "not_started", durationMinutes: 90, startedAt: null, endsAt: null, stoppedAt: null }}
        durationInput="144000"
        competitionPending={false}
        onOpenQuestion={vi.fn()}
        onManageQuestions={vi.fn()}
        onCreateQuestion={vi.fn()}
        onDurationChange={vi.fn()}
        onStartCompetition={vi.fn()}
        onStopCompetition={vi.fn()}
        onCompetitionExpired={vi.fn()}
      />,
    );

    expect(html).toContain("比赛未开始");
    expect(html).toContain("比赛时长");
    expect(html).toContain('value="144000"');
    expect(html).not.toContain('max="1440"');
    expect(html).toContain("开始比赛");
    expect(html).toContain("未开始");
    expect(html).toContain("题目管理");
    expect(html.match(/title="进入题目管理"/g)).toHaveLength(1);
    expect(html).not.toContain("题目发布与答题概览");
    expect(html).not.toContain("dashboard-status-grid");
    const answerOverview = html.slice(
      html.indexOf('class="dashboard-panel dashboard-answer-overview"'),
      html.indexOf('class="dashboard-panel dashboard-question-overview"'),
    );
    expect(answerOverview).toContain("全部题目答题概览");
    expect(answerOverview).toContain("题目管理");
    expect(html).not.toContain(">新建题目</button>");
    expect(html).toContain("赛前大屏公告");
    expect(html).toContain("比赛未开始时展示");
    expect(html).not.toContain("作答中");
  });

  it("shows countdown and an always-available stop command while running", () => {
    const html = renderToStaticMarkup(
      <JudgeDashboard
        questions={[question(1, "published"), question(2, "published")]}
        loading={false}
        competition={{ state: "running", durationMinutes: 90, startedAt: "2026-08-25T08:00:00.000Z", endsAt: "2026-08-25T09:30:00.000Z", stoppedAt: null }}
        durationInput="90"
        competitionPending={false}
        onOpenQuestion={vi.fn()}
        onManageQuestions={vi.fn()}
        onCreateQuestion={vi.fn()}
        onDurationChange={vi.fn()}
        onStartCompetition={vi.fn()}
        onStopCompetition={vi.fn()}
        onCompetitionExpired={vi.fn()}
      />,
    );

    expect(html).toContain("比赛进行中");
    expect(html).toContain("开始时间");
    expect(html).toContain("比赛剩余时间");
    expect(html).toContain("停止比赛");
    expect(html).toContain("作答中");
    expect(html).toMatch(/<strong>\d{2}:\d{2}:\d{2}<\/strong>/);
    const stopButton = html.match(/<button[^>]*secondary-action danger[^>]*>[\s\S]*?停止比赛<\/button>/)?.[0];
    expect(stopButton).toBeTruthy();
    expect(stopButton).not.toContain('disabled=""');
    expect(html).toContain("赛前大屏公告");
  });

  it("allows a stopped competition to restart without removing answers", () => {
    const stopped = question(1, "published");
    stopped.progress = { total: 6, submitted: 1, drafting: 1, notStarted: 4 };
    const html = renderToStaticMarkup(
      <JudgeDashboard
        questions={[stopped]}
        loading={false}
        competition={{ state: "ended", durationMinutes: 45, startedAt: "2026-08-25T08:00:00.000Z", endsAt: "2026-08-25T08:20:00.000Z", stoppedAt: "2026-08-25T08:20:00.000Z" }}
        durationInput="45"
        competitionPending={false}
        onOpenQuestion={vi.fn()}
        onManageQuestions={vi.fn()}
        onCreateQuestion={vi.fn()}
        onDurationChange={vi.fn()}
        onStartCompetition={vi.fn()}
        onStopCompetition={vi.fn()}
        onCompetitionExpired={vi.fn()}
      />,
    );

    expect(html).toContain("比赛已结束");
    expect(html).toContain('value="45"');
    expect(html).toContain("重新开始比赛");
    expect(html).toContain("已提交");
    expect(html).toContain("已停止");
    expect(html).not.toContain("作答中");
  });
});
