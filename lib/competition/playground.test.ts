import { describe, expect, it } from "vitest";

import {
  buildPlaygroundApiCall,
  buildPlaygroundPayload,
  playgroundRequestSchema,
} from "./playground";

describe("contestant playground", () => {
  it("builds an OpenAI-compatible multimodal Qwen request", () => {
    const input = playgroundRequestSchema.parse({
      model: "qwen3.7-plus",
      family: "qwen",
      supportsImage: true,
      prompt: "这张图里有什么？",
      systemPrompt: "回答要简洁",
      imageUrl: "data:image/png;base64,aGVsbG8=",
      enableThinking: true,
      temperature: 0.4,
      maxTokens: 512,
    });

    expect(buildPlaygroundPayload(input)).toEqual({
      model: "qwen3.7-plus",
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
      model: "deepseek-v4-pro",
      family: "deepseek",
      prompt: "识别图片",
      imageUrl: "data:image/png;base64,aGVsbG8=",
    });

    expect(() => buildPlaygroundPayload(input)).toThrow(
      "playground_image_not_supported",
    );
  });

  it("accepts an HTTPS image URL and rejects an insecure URL", () => {
    expect(playgroundRequestSchema.parse({
      model: "qwen3.7-flash",
      family: "qwen",
      supportsImage: true,
      prompt: "分析图片",
      imageUrl: "https://example.com/image.png",
    }).imageUrl).toBe("https://example.com/image.png");
    expect(() => playgroundRequestSchema.parse({
      model: "qwen3.7-flash",
      family: "qwen",
      supportsImage: true,
      prompt: "分析图片",
      imageUrl: "http://example.com/image.png",
    })).toThrow();
  });

  it("does not impose a local size limit on Base64 image input", () => {
    const base64 = "A".repeat(1_400_000);
    const input = playgroundRequestSchema.parse({
      model: "qwen3.7-flash",
      family: "qwen",
      supportsImage: true,
      prompt: "分析图片",
      imageUrl: `data:image/png;base64,${base64}`,
    });

    expect(input.imageUrl).toHaveLength(base64.length + 22);
  });

  it("uses the public OpenAI-compatible route and contestant API key", () => {
    const input = playgroundRequestSchema.parse({
      model: "deepseek-v4-flash",
      family: "deepseek",
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
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
    });
  });

  it("keeps provider-managed thinking defaults for new domestic families", () => {
    const input = playgroundRequestSchema.parse({
      model: "kimi/kimi-k3",
      family: "kimi",
      prompt: "hello",
      enableThinking: true,
    });

    expect(buildPlaygroundPayload(input)).toMatchObject({
      model: "kimi/kimi-k3",
      messages: [{ role: "user", content: "hello" }],
    });
    expect(buildPlaygroundPayload(input)).not.toHaveProperty("thinking");
    expect(buildPlaygroundPayload(input)).not.toHaveProperty(
      "enable_thinking",
    );
    expect(buildPlaygroundPayload(input)).not.toHaveProperty("temperature");
  });
});
