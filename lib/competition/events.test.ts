import { describe, expect, it } from "vitest";

import { coalesceCompetitionEvents, type StoredCompetitionEvent } from "./events";

describe("competition event delivery", () => {
  it("keeps only the newest event for each type and question", () => {
    const events: StoredCompetitionEvent[] = [
      { id: 11, type: "answer-updated", questionId: 4, at: "2026-08-18 10:00:00.000" },
      { id: 12, type: "answer-updated", questionId: 4, at: "2026-08-18 10:00:00.100" },
      { id: 13, type: "question-updated", questionId: 4, at: "2026-08-18 10:00:00.200" },
      { id: 14, type: "answer-updated", questionId: 5, at: "2026-08-18 10:00:00.300" },
    ];

    expect(coalesceCompetitionEvents(events).map((event) => event.id)).toEqual([12, 13, 14]);
  });
});
