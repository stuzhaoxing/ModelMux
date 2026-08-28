import { describe, expect, it } from "vitest";

import {
  questionTitleIsWithinLimit,
  questionTitleLength,
  questionTitleMaxLength,
} from "./question";

describe("competition question title", () => {
  it("limits titles to 50 visible characters", () => {
    expect(questionTitleMaxLength).toBe(50);
    expect(questionTitleIsWithinLimit("题".repeat(50))).toBe(true);
    expect(questionTitleIsWithinLimit("题".repeat(51))).toBe(false);
  });

  it("counts Unicode characters rather than UTF-16 code units", () => {
    expect(questionTitleLength("题目😀")).toBe(3);
  });
});
