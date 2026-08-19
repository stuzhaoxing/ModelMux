import { describe, expect, it } from "vitest";

import {
  contestantDefaultRequestQuota,
  generateContestantApiKey,
} from "./api-access";

function envWithQuota(value: string): NodeJS.ProcessEnv {
  return { NODE_ENV: "test", MODELMUX_CONTESTANT_REQUEST_QUOTA: value };
}

describe("contestant API access", () => {
  it("generates unique OpenAI-compatible contestant keys", () => {
    const first = generateContestantApiKey();
    const second = generateContestantApiKey();

    expect(first).toMatch(/^sk-competition-[A-Za-z0-9_-]{32}$/);
    expect(second).toMatch(/^sk-competition-[A-Za-z0-9_-]{32}$/);
    expect(second).not.toBe(first);
  });

  it("uses a positive configured default quota and rejects invalid values", () => {
    expect(contestantDefaultRequestQuota(envWithQuota("2500"))).toBe(2500);
    expect(contestantDefaultRequestQuota(envWithQuota("0"))).toBe(1000);
    expect(contestantDefaultRequestQuota(envWithQuota("invalid"))).toBe(1000);
  });
});
