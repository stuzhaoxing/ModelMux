import { describe, expect, it } from "vitest";

import { buildQuickStartExamples } from "./api-examples";

const input = {
  apiKey: "sk-competition-test",
  model: "deepseek-v4-flash",
  openAiBaseUrl: "http://localhost:1444/v1",
};

describe("contestant API examples", () => {
  it("covers cURL and every application language on the OpenAI SDK page", () => {
    const examples = buildQuickStartExamples(input);

    expect(examples.map((example) => example.label)).toEqual([
      "cURL",
      "JavaScript",
      "Python",
      ".NET",
      "Java",
      "Go",
      "Ruby",
    ]);
    expect(examples).toHaveLength(7);
    expect(examples.every((example) => example.code.includes("sk-competition-test"))).toBe(true);
    expect(examples.every((example) => example.code.includes("http://localhost:1444/v1"))).toBe(true);
    expect(examples[0].code).toContain("Authorization: Bearer");
    expect(examples[0].code).toContain("/chat/completions");
  });
});
