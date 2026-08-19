import { describe, expect, it } from "vitest";

import { eventStreamRetryDelayMs } from "./event-stream";

describe("event stream reconnect backoff", () => {
  it("retries quickly at first so a service restart is barely noticed", () => {
    expect(eventStreamRetryDelayMs(1)).toBe(1_000);
    expect(eventStreamRetryDelayMs(2)).toBe(2_000);
    expect(eventStreamRetryDelayMs(3)).toBe(4_000);
  });

  it("caps the delay so a long outage still recovers within seconds of coming back", () => {
    expect(eventStreamRetryDelayMs(5)).toBe(15_000);
    expect(eventStreamRetryDelayMs(50)).toBe(15_000);
  });

  it("treats a missing or bogus attempt count as the first retry", () => {
    expect(eventStreamRetryDelayMs(0)).toBe(1_000);
    expect(eventStreamRetryDelayMs(-3)).toBe(1_000);
  });
});
