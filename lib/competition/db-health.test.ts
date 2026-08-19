import { describe, expect, it } from "vitest";

import { databaseProbeErrorCode } from "./db-health";

describe("database probe error classification", () => {
  it("maps connection failures to a stable code", () => {
    expect(databaseProbeErrorCode(Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3306"), { code: "ECONNREFUSED" })))
      .toBe("unreachable");
    expect(databaseProbeErrorCode(Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" })))
      .toBe("unreachable");
  });

  it("separates credential and schema problems from plain outages", () => {
    expect(databaseProbeErrorCode(Object.assign(new Error("denied"), { code: "ER_ACCESS_DENIED_ERROR" })))
      .toBe("auth_failed");
    expect(databaseProbeErrorCode(Object.assign(new Error("unknown database"), { code: "ER_BAD_DB_ERROR" })))
      .toBe("missing_database");
  });

  it("reports the probe timeout without leaking the driver message", () => {
    expect(databaseProbeErrorCode(new Error("database_probe_timeout"))).toBe("timeout");
    expect(databaseProbeErrorCode(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }))).toBe("timeout");
  });

  it("falls back to a generic code for anything else", () => {
    expect(databaseProbeErrorCode(new Error("mysql://modelmux:secret@10.20.0.1/modelmux failed"))).toBe("error");
    expect(databaseProbeErrorCode(null)).toBe("error");
  });
});
