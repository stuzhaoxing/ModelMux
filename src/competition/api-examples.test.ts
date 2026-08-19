import { describe, expect, it } from "vitest";

import { buildQuickStartExamples } from "./api-examples";

const input = {
  apiKey: "sk-competition-test",
  model: "deepseek-flash",
  openAiBaseUrl: "http://localhost:1444/v1",
  anthropicBaseUrl: "http://localhost:1444",
};

describe("contestant API examples", () => {
  it("covers cURL and every application language on the OpenAI SDK page", () => {
    const examples = buildQuickStartExamples("openai", input);

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

  it("covers cURL and every application language on the Anthropic SDK page", () => {
    const examples = buildQuickStartExamples("anthropic", input);

    expect(examples.map((example) => example.label)).toEqual([
      "cURL",
      "Python",
      "TypeScript",
      "C#",
      "Go",
      "Java",
      "PHP",
      "Ruby",
    ]);
    expect(examples).toHaveLength(8);
    expect(examples.every((example) => example.code.includes("sk-competition-test"))).toBe(true);
    expect(examples.every((example) => example.code.includes("http://localhost:1444"))).toBe(true);
    expect(examples[0].code).toContain("x-api-key");
    expect(examples[0].code).toContain("anthropic-version: 2023-06-01");
    expect(examples[0].code).toContain("/v1/messages");
  });
});
