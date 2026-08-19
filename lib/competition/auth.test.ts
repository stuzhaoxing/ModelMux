import { describe, expect, it } from "vitest";

import { adminSessionCookieName } from "../admin/auth";
import { hashPassword, sessionCookieName, verifyPassword } from "./auth";

describe("competition password hashing", () => {
  it("verifies the right password and rejects the wrong one", async () => {
    const encoded = await hashPassword("现场测试密码-123");
    expect(encoded).toMatch(/^scrypt\$/);
    await expect(verifyPassword("现场测试密码-123", encoded)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", encoded)).resolves.toBe(false);
  });

  it("keeps one competition session per browser, separate from the admin one", () => {
    expect(sessionCookieName).toBe("modelmux_competition_session");
    expect(sessionCookieName).not.toBe(adminSessionCookieName);
  });
});
