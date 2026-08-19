import { describe, expect, it } from "vitest";

import { healthOutcome } from "./health";

describe("health outcome", () => {
  it("reports ok only when the gateway is enabled, configured and the database answers", () => {
    expect(healthOutcome({ serviceEnabled: true, configured: true, databaseReady: true }))
      .toEqual({ status: "ok", ready: true });
  });

  it("keeps a suspended gateway healthy so the admin console stays reachable", () => {
    expect(healthOutcome({ serviceEnabled: false, configured: false, databaseReady: true }))
      .toEqual({ status: "suspended", ready: true });
  });

  it("reports needs_config when the gateway runs without provider or client keys", () => {
    expect(healthOutcome({ serviceEnabled: true, configured: false, databaseReady: true }))
      .toEqual({ status: "needs_config", ready: false });
  });

  it("reports degraded whenever the competition database is unreachable", () => {
    expect(healthOutcome({ serviceEnabled: true, configured: true, databaseReady: false }))
      .toEqual({ status: "degraded", ready: false });
    expect(healthOutcome({ serviceEnabled: false, configured: true, databaseReady: false }))
      .toEqual({ status: "degraded", ready: false });
  });
});
