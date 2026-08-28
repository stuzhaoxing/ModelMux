import { describe, expect, it } from "vitest";

import { nextProviderKey } from "./runtime";

describe("provider key rotation", () => {
  it("rotates through each key without changing the request path", () => {
    const pool = `pool-${crypto.randomUUID()}`;

    expect(nextProviderKey(pool, ["first", "second"])).toBe("first");
    expect(nextProviderKey(pool, ["first", "second"])).toBe("second");
    expect(nextProviderKey(pool, ["first", "second"])).toBe("first");
  });
});
