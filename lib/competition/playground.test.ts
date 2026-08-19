import { describe, expect, it } from "vitest";

import {
  buildPlaygroundApiCall,
  buildPlaygroundPayload,
  playgroundRequestSchema,
} from "./playground";

describe("contestant playground", () => {
  it("builds an OpenAI-compatible multimodal Qwen request", () => {
    const input = playgroundRequestSchema.parse({
      model: "qwen-pro",
      prompt: "这张图里有什么？",
      systemPrompt: "回答要简洁",
      imageUrl: "data:image/png;base64,aGVsbG8=",
      enableThinking: true,
      temperature: 0.4,
      maxTokens: 512,
    });

    expect(buildPlaygroundPayload(input)).toEqual({
      model: "qwen-pro",
      messages: [
        { role: "system", content: "回答要简洁" },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: "data:image/png;base64,aGVsbG8=" },
            },
            { type: "text", text: "这张图里有什么？" },
          ],
        },
      ],
      stream: false,
      temperature: 0.4,
      max_tokens: 512,
      enable_thinking: true,
    });
  });

  it("rejects image input for a DeepSeek route", () => {
    const input = playgroundRequestSchema.parse({
      model: "deepseek-pro",
      prompt: "识别图片",
      imageUrl: "data:image/png;base64,aGVsbG8=",
    });

    expect(() => buildPlaygroundPayload(input)).toThrow(
      "playground_image_requires_qwen",
    );
  });

  it("accepts an HTTPS image URL and rejects an insecure URL", () => {
    expect(playgroundRequestSchema.parse({
      model: "qwen-flash",
      prompt: "分析图片",
      imageUrl: "https://example.com/image.png",
    }).imageUrl).toBe("https://example.com/image.png");
    expect(() => playgroundRequestSchema.parse({
      model: "qwen-flash",
      prompt: "分析图片",
      imageUrl: "http://example.com/image.png",
    })).toThrow();
  });

  it("uses the public OpenAI-compatible route and contestant API key", () => {
    const input = playgroundRequestSchema.parse({
      model: "deepseek-flash",
      prompt: "hello",
    });

    const call = buildPlaygroundApiCall(
      "http://192.168.1.216:1444/v1",
      "sk-competition-test",
      input,
    );
    const headers = new Headers(call.init.headers);

    expect(call.path).toBe("/v1/chat/completions");
    expect(call.init.method).toBe("POST");
    expect(headers.get("Authorization")).toBe("Bearer sk-competition-test");
    expect(JSON.parse(String(call.init.body))).toMatchObject({
      model: "deepseek-flash",
      messages: [{ role: "user", content: "hello" }],
    });
  });
});
