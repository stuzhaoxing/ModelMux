import { describe, expect, it } from "vitest";

import { consumeRateLimit } from "./runtime";

describe("rate limit", () => {
  it("limits each client within a rolling minute bucket", () => {
    const client = `client-${crypto.randomUUID()}`;
    const beganAt = 1_000;

    expect(consumeRateLimit(client, 2, beganAt).allowed).toBe(true);
    expect(consumeRateLimit(client, 2, beganAt + 1).allowed).toBe(true);
    expect(consumeRateLimit(client, 2, beganAt + 2).allowed).toBe(false);
    expect(consumeRateLimit(client, 2, beganAt + 60_001).allowed).toBe(true);
  });
});
