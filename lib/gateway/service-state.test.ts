import { describe, expect, it, vi } from "vitest";

const readStateFile = vi.hoisted(() => vi.fn());
vi.mock("./state-file", () => ({ readStateFile }));

import { gatewayServiceState } from "./service-state";

describe("always-on gateway service", () => {
  it.each([
    { status: "missing" },
    { status: "invalid" },
    { status: "ok", value: { enabled: false, updatedAt: "2026-08-13T02:30:00.000Z" } },
  ])("ignores legacy service state %j", async (legacyState) => {
    readStateFile.mockReturnValue(legacyState);
    await expect(gatewayServiceState()).resolves.toEqual({
      enabled: true, updatedAt: null, stateFileValid: true,
    });
    expect(readStateFile).not.toHaveBeenCalled();
  });
});
