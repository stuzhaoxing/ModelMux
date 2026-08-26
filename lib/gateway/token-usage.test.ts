import { describe, expect, it, vi } from "vitest";

import { meterTokenUsage, tokenUsageFromPayload } from "./token-usage";

describe("gateway token usage", () => {
  it("normalizes provider usage field variants", () => {
    expect(tokenUsageFromPayload({
      usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
    })).toEqual({ inputTokens: 12, outputTokens: 7, totalTokens: 19 });
    expect(tokenUsageFromPayload({
      usage: { input_tokens: 8, output_tokens: 5 },
    })).toEqual({ inputTokens: 8, outputTokens: 5, totalTokens: 13 });
  });

  it("passes a JSON response through unchanged and records its usage", async () => {
    const source = JSON.stringify({
      choices: [{ message: { content: "完成" } }],
      usage: { prompt_tokens: 20, completion_tokens: 9, total_tokens: 29 },
    });
    const onUsage = vi.fn(async () => undefined);
    const response = new Response(meterTokenUsage(
      new Response(source).body!,
      false,
      onUsage,
    ));

    expect(await response.text()).toBe(source);
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 20, outputTokens: 9, totalTokens: 29 });
  });

  it("collects usage from a split SSE event without changing the stream", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      "data: {\"choices\":[{\"delta\":{\"content\":\"好\"}}]}\n\n",
      "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":31,",
      "\"completion_tokens\":11,\"total_tokens\":42}}\n\ndata: [DONE]\n\n",
    ];
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    const onUsage = vi.fn(async () => undefined);
    const response = new Response(meterTokenUsage(source, true, onUsage));

    expect(await response.text()).toBe(chunks.join(""));
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 31, outputTokens: 11, totalTokens: 42 });
  });
});
