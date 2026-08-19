import { describe, expect, it } from "vitest";

import { loginInputSchema } from "./login-input";

describe("unified login input", () => {
  it("accepts the payload the login page actually sends", () => {
    // 登录页没有 ?next= 时发的就是 next: null —— 这里曾经被 schema 挡在 400。
    expect(loginInputSchema.safeParse({
      username: "judge-8r5xbp",
      password: "secret",
      next: null,
    }).success).toBe(true);

    expect(loginInputSchema.safeParse({
      username: "judge-8r5xbp",
      password: "secret",
      role: null,
      next: null,
    }).success).toBe(true);
  });

  it("still accepts an omitted or filled-in next and role", () => {
    expect(loginInputSchema.safeParse({ username: "a", password: "b" }).success).toBe(true);
    const parsed = loginInputSchema.parse({
      username: "  Judge-1  ",
      password: "b",
      role: "judge",
      next: "/judge/answers",
    });
    expect(parsed.username).toBe("Judge-1");
    expect(parsed.role).toBe("judge");
    expect(parsed.next).toBe("/judge/answers");
  });

  it("rejects empty, oversized or unknown-role input", () => {
    expect(loginInputSchema.safeParse({ username: "", password: "b" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "a", password: "" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "a".repeat(65), password: "b" }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "a", password: "b".repeat(201) }).success).toBe(false);
    expect(loginInputSchema.safeParse({ username: "a", password: "b", role: "admin" }).success).toBe(false);
  });
});
