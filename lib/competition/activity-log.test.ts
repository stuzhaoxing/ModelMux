import { describe, expect, it } from "vitest";

import {
  activityActionLabel,
  modelCallDetail,
  outcomeForStatus,
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

  it("describes a model call with its model, duration and outcome", () => {
    expect(
      modelCallDetail({ model: "deepseek-v4-pro", durationMs: 1240, errorCode: null, remaining: 998 }),
    ).toBe("deepseek-v4-pro · 1.2s · 剩余 998 次");
    expect(
      modelCallDetail({ model: "qwen-vl", durationMs: 300, errorCode: "quota_exceeded", remaining: 0 }),
    ).toBe("qwen-vl · 0.3s · 额度已用完");
  });

  it("treats rate limiting as a warning and other failures as errors", () => {
    expect(outcomeForStatus(200)).toBe("ok");
    expect(outcomeForStatus(429)).toBe("warn");
    expect(outcomeForStatus(502)).toBe("error");
  });

  it("records one draft-save line per contestant and question per window", () => {
    const start = 1_000_000;
    expect(shouldRecordDraftSave("7:3", start)).toBe(true);
    expect(shouldRecordDraftSave("7:3", start + 1_500)).toBe(false);
    expect(shouldRecordDraftSave("7:4", start + 1_500)).toBe(true);
    expect(shouldRecordDraftSave("7:3", start + 61_000)).toBe(true);
  });
});
