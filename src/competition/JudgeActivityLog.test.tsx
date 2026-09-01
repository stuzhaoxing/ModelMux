import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ActivityEntry } from "@/lib/competition/types";
import { JudgeActivityLog } from "./JudgeActivityLog";

const entry: ActivityEntry = {
  id: 79,
  category: "answer",
  action: "answer-submitted",
  actorRole: "contestant",
  actorId: 19,
  actorUsername: "contestant-19",
  actorName: "选手 19",
  questionId: 5,
  questionTitle: "模拟题5",
  detail: null,
  outcome: "ok",
  at: "2026-09-01T11:48:51.000Z",
};

describe("JudgeActivityLog", () => {
  it("renders the standalone live log without the old collapse control", () => {
    const html = renderToStaticMarkup(
      <JudgeActivityLog
        entries={[entry]}
        total={79}
        online
        loading={false}
        loadingOlder={false}
        hasOlder
        onLoadOlder={() => undefined}
      />,
    );

    expect(html).toContain("累计 79 条记录");
    expect(html).toContain("实时连接");
    expect(html).toContain("答题动态 1");
    expect(html).toContain("提交答卷");
    expect(html).toContain("加载更早的记录");
    expect(html).not.toContain("收起日志");
    expect(html).not.toContain("展开现场日志");
  });
});
