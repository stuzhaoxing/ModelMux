import { describe, expect, it } from "vitest";

import { generateContestantApiKey } from "./api-access";

describe("contestant API access", () => {
  it("generates unique OpenAI-compatible contestant keys", () => {
    const first = generateContestantApiKey();
    const second = generateContestantApiKey();

    expect(first).toMatch(/^sk-competition-[A-Za-z0-9_-]{32}$/);
    expect(second).toMatch(/^sk-competition-[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
  });
});
