import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { CompetitionScreenSnapshot } from "@/lib/competition/screen-model";
import CompetitionScreen from "./CompetitionScreen";

function snapshot(): CompetitionScreenSnapshot {
  return {
    generatedAt: "2026-09-09T08:00:00.000Z",
    mode: "test",
    stage: "rehearsal",
    schedule: { configured: false, startAt: null, endAt: null },
    competition: { phase: "test", state: "not_started", durationMinutes: 90, startedAt: null, endsAt: null, stoppedAt: null },
    notice: { title: "赛前提醒", content: "", enabled: false, updatedAt: null },
    summary: { contestantTotal: 0, questionTotal: 0, publishedQuestions: 0, closedQuestions: 0, fullySubmitted: 0, unfinished: 0, drafting: 0, notStarted: 0, totalTokens: 0 },
    tokenMinutes: [],
    contestants: [],
  };
}

describe("competition screen phases", () => {
  it.each([
    { submitted: 0, drafting: 3, status: "drafting" as const, width: 0 },
    { submitted: 1, drafting: 2, status: "drafting" as const, width: 33 },
    { submitted: 3, drafting: 0, status: "submitted" as const, width: 100 },
  ])("renders only submitted answers in progress: $submitted submitted, $drafting drafts", ({ submitted, drafting, status, width }) => {
    const initialSnapshot = snapshot();
    initialSnapshot.mode = "competition";
    initialSnapshot.competition = { ...initialSnapshot.competition, phase: "competition", state: "running", startedAt: "2026-09-09T07:30:00.000Z", endsAt: "2026-09-09T09:00:00.000Z" };
    initialSnapshot.summary.questionTotal = 3;
    initialSnapshot.contestants = [{
      id: 1, name: "测试选手", submitted, drafting, status,
      notStarted: 0, lastActivityAt: null, durationSeconds: null, durationKind: null,
    }];
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={initialSnapshot} />);
    expect(html).toContain(`<strong>${submitted}/3</strong>`);
    expect(html).toContain(`style="width:${width}%"`);
    expect(html).toContain(status === "submitted" ? "已交卷" : "答题中");
  });

  it("shows a default announcement and no competition countdown before formal start", () => {
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={snapshot()} />);
    expect(html).toContain("测试");
    expect(html).toContain("赛前公告");
    expect(html).toContain("当前为赛前测试环节，正式比赛尚未开始。");
    expect(html).not.toContain("比赛已结束");
    expect(html).not.toContain("剩余时间");
    expect(html).not.toContain('data-countdown="true"');
  });

  it("shows the saved announcement during testing", () => {
    const initialSnapshot = snapshot();
    initialSnapshot.notice.content = "请核对参赛账号";
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={initialSnapshot} />);
    expect(html).toContain("请核对参赛账号");
    expect(html).not.toContain("当前为赛前测试环节，正式比赛尚未开始。");
  });

  it("hides the saved announcement while the formal competition is running", () => {
    const state = "running";
    const initialSnapshot = snapshot();
    initialSnapshot.mode = "competition";
    initialSnapshot.competition = { ...initialSnapshot.competition, phase: "competition", state, startedAt: "2026-09-09T07:30:00.000Z", endsAt: "2026-09-09T09:00:00.000Z" };
    initialSnapshot.schedule = { configured: true, startAt: initialSnapshot.competition.startedAt, endAt: initialSnapshot.competition.endsAt };
    initialSnapshot.notice.content = "请核对参赛账号";
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={initialSnapshot} />);
    expect(html).toContain("比赛中");
    expect(html).not.toContain("赛前公告");
    expect(html).not.toContain("请核对参赛账号");
  });
  it.each(["manual", "automatic"])("hides the saved announcement after %s end", (endReason) => {
    const initialSnapshot = snapshot();
    initialSnapshot.mode = "competition";
    initialSnapshot.competition = { phase: "competition", state: "ended", durationMinutes: 90, startedAt: "2026-09-09T07:30:00.000Z", endsAt: "2026-09-09T07:59:00.000Z", stoppedAt: endReason === "manual" ? "2026-09-09T07:59:00.000Z" : null };
    initialSnapshot.schedule = { configured: true, startAt: initialSnapshot.competition.startedAt, endAt: initialSnapshot.competition.endsAt };
    initialSnapshot.notice = { title: "考务提醒", content: "请核对参赛账号", enabled: false, updatedAt: null };
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={initialSnapshot} />);
    expect(html).toContain("比赛已结束");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("考务提醒");
    expect(html).not.toContain("请核对参赛账号");
    expect(html).not.toContain("正式比赛尚未开始");
  });

  it("does not show a misleading default pre-start notice after stop when no notice was saved", () => {
    const initialSnapshot = snapshot();
    initialSnapshot.mode = "competition";
    initialSnapshot.competition = { ...initialSnapshot.competition, phase: "competition", state: "ended", startedAt: "2026-09-09T07:30:00.000Z", endsAt: "2026-09-09T07:59:00.000Z" };
    const html = renderToStaticMarkup(<CompetitionScreen initialSnapshot={initialSnapshot} />);
    expect(html).toContain("比赛已结束");
    expect(html).not.toContain('role="dialog"');
  });

});
