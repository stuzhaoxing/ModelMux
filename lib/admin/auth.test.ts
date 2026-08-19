import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adminAuthConfigured,
  createAdminSessionToken,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from "./auth";

const originalEnv = {
  password: process.env.MODELMUX_ADMIN_PASSWORD,
  sessionSecret: process.env.MODELMUX_ADMIN_SESSION_SECRET,
};

describe("administrator authentication", () => {
  beforeEach(() => {
    process.env.MODELMUX_ADMIN_PASSWORD = "strong-local-password";
    process.env.MODELMUX_ADMIN_SESSION_SECRET = "a".repeat(64);
  });

  afterEach(() => {
    process.env.MODELMUX_ADMIN_PASSWORD = originalEnv.password;
    process.env.MODELMUX_ADMIN_SESSION_SECRET = originalEnv.sessionSecret;
  });

  it("requires a complete administrator configuration", () => {
    expect(adminAuthConfigured()).toBe(true);
    process.env.MODELMUX_ADMIN_SESSION_SECRET = "too-short";
    expect(adminAuthConfigured()).toBe(false);
  });

  it("checks the administrator password", () => {
    expect(verifyAdminPassword("strong-local-password")).toBe(true);
    expect(verifyAdminPassword("wrong-password")).toBe(false);
  });

  it("accepts signed sessions and rejects expired or modified tokens", () => {
    const now = Date.parse("2026-08-13T10:00:00Z");
    const token = createAdminSessionToken(now);
    expect(verifyAdminSessionToken(token, now)?.expiresAt).toBeGreaterThan(Math.floor(now / 1000));
    expect(verifyAdminSessionToken(`${token}changed`, now)).toBeNull();
    expect(verifyAdminSessionToken(token, now + 9 * 60 * 60 * 1000)).toBeNull();
  });

  it("invalidates existing sessions after an administrator password change", () => {
    const token = createAdminSessionToken();
    process.env.MODELMUX_ADMIN_PASSWORD = "rotated-password";
    expect(verifyAdminSessionToken(token)).toBeNull();
  });
});
