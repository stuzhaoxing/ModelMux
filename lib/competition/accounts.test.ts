import { describe, expect, it } from "vitest";

import { autoCreateCompetitionUserSchema, createCompetitionUserSchema } from "./accounts";

describe("competition account input", () => {
  it.each(["contestant", "judge"] as const)(
    "creates a %s with account, password and display name",
    (role) => {
      expect(
        createCompetitionUserSchema.parse({
          role,
          username: `${role}01`,
          displayName: role === "judge" ? "测试评委" : "测试选手",
          password: "test-password-123",
        }),
      ).toEqual({
        role,
        username: `${role}01`,
        displayName: role === "judge" ? "测试评委" : "测试选手",
        password: "test-password-123",
      });
    },
  );

  it("accepts an automatic account generation request", () => {
    expect(autoCreateCompetitionUserSchema.parse({ role: "contestant", autoGenerate: true })).toEqual({
      role: "contestant",
      autoGenerate: true,
    });
  });
});
