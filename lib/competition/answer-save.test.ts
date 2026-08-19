import { describe, expect, it } from "vitest";

import { answerSaveCoversCurrentRevision } from "./answer-save";

describe("answer save revision tracking", () => {
  it("marks a save current only when no newer edit exists", () => {
    expect(answerSaveCoversCurrentRevision(4, 4)).toBe(true);
    expect(answerSaveCoversCurrentRevision(4, 5)).toBe(false);
  });
});
