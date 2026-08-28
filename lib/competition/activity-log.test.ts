import { describe, expect, it } from "vitest";

import {
  activityActionLabel,
  shouldRecordDraftSave,
} from "./activity-log";

describe("competition activity log", () => {
  it("labels every recorded action in Chinese", () => {
    expect(activityActionLabel("answer-submitted")).toBe("提交答卷");
    expect(activityActionLabel("question-deleted")).toBe("删除题目");
    expect(activityActionLabel("competition-started")).toBe("开始比赛");
    expect(activityActionLabel("competition-stopped")).toBe("停止比赛");
    expect(activityActionLabel("model-rejected")).toBe("调用被拒绝");
    expect(activityActionLabel("unknown-action")).toBe("unknown-action");
  });

  it("records one draft-save line per contestant and question per window", () => {
    const start = 1_000_000;
    expect(shouldRecordDraftSave("7:3", start)).toBe(true);
    expect(shouldRecordDraftSave("7:3", start + 1_500)).toBe(false);
    expect(shouldRecordDraftSave("7:4", start + 1_500)).toBe(true);
    expect(shouldRecordDraftSave("7:3", start + 61_000)).toBe(true);
  });
});
