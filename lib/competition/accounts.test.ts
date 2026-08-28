import { describe, expect, it } from "vitest";

import { autoCreateCompetitionUserSchema, createCompetitionUserSchema } from "./accounts";

describe("competition account input", () => {
  it("creates a contestant with account, password and display name", () => {
    expect(
      createCompetitionUserSchema.parse({
        role: "contestant",
        username: "contestant01",
        displayName: "测试选手",
        password: "test-password-123",
      }),
    ).toEqual({
      role: "contestant",
      username: "contestant01",
      displayName: "测试选手",
      password: "test-password-123",
    });
  });

  it("rejects judge account issuance because judges use admin", () => {
    expect(createCompetitionUserSchema.safeParse({
      role: "judge",
      username: "judge01",
      displayName: "测试评委",
      password: "test-password-123",
    }).success).toBe(false);
    expect(autoCreateCompetitionUserSchema.safeParse({
      role: "judge",
      autoGenerate: true,
    }).success).toBe(false);
  });

  it("accepts an automatic account generation request", () => {
    expect(autoCreateCompetitionUserSchema.parse({ role: "contestant", autoGenerate: true })).toEqual({
      role: "contestant",
      autoGenerate: true,
    });
  });
});
