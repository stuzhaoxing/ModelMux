import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  adminSessionCookieName,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "../admin/auth";
import { sessionCookieName } from "./auth";
import {
  createScreenSessionToken,
  screenAuthConfigured,
  screenSessionCookieName,
  verifyScreenPassword,
  verifyScreenSessionToken,
} from "./screen-auth";

const originalEnv = {
  password: process.env.MODELMUX_ADMIN_PASSWORD,
  sessionSecret: process.env.MODELMUX_ADMIN_SESSION_SECRET,
};

function restoreEnv(name: "MODELMUX_ADMIN_PASSWORD" | "MODELMUX_ADMIN_SESSION_SECRET", value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("competition screen authentication", () => {
  beforeEach(() => {
    process.env.MODELMUX_ADMIN_PASSWORD = "strong-local-password";
    process.env.MODELMUX_ADMIN_SESSION_SECRET = "b".repeat(64);
  });

  afterEach(() => {
    restoreEnv("MODELMUX_ADMIN_PASSWORD", originalEnv.password);
    restoreEnv("MODELMUX_ADMIN_SESSION_SECRET", originalEnv.sessionSecret);
  });

  it("uses the administrator password and configuration", () => {
    expect(screenAuthConfigured()).toBe(true);
    expect(verifyScreenPassword("strong-local-password")).toBe(true);
    expect(verifyScreenPassword("wrong-password")).toBe(false);
  });

  it("keeps the screen cookie separate from administrator and contestant sessions", () => {
    expect(screenSessionCookieName).not.toBe(adminSessionCookieName);
    expect(screenSessionCookieName).not.toBe(sessionCookieName);
  });

  it("accepts signed sessions and rejects expired or modified tokens", () => {
    const now = Date.parse("2026-08-21T02:00:00Z");
    const token = createScreenSessionToken(now);
    expect(verifyScreenSessionToken(token, now)?.expiresAt).toBeGreaterThan(Math.floor(now / 1000));
    expect(verifyScreenSessionToken(`${token}changed`, now)).toBeNull();
    expect(verifyScreenSessionToken(token, now + 9 * 60 * 60 * 1000)).toBeNull();
  });

  it("does not accept administrator sessions as screen sessions or vice versa", () => {
    const adminToken = createAdminSessionToken();
    const screenToken = createScreenSessionToken();
    expect(verifyScreenSessionToken(adminToken)).toBeNull();
    expect(verifyAdminSessionToken(screenToken)).toBeNull();
  });

  it("invalidates existing sessions after an administrator password change", () => {
    const token = createScreenSessionToken();
    process.env.MODELMUX_ADMIN_PASSWORD = "rotated-password";
    expect(verifyScreenSessionToken(token)).toBeNull();
  });
});
