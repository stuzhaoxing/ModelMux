import { z } from "zod";

export const playgroundImageMaxBytes = 1024 * 1024;
const playgroundImageDataUrlMaxLength = Math.ceil(playgroundImageMaxBytes * 4 / 3) + 128;
const playgroundImageDataUrlSchema = z
  .string()
  .max(playgroundImageDataUrlMaxLength)
  .regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/);
const playgroundRemoteImageUrlSchema = z
  .string()
  .url()
  .max(2_000)
  .refine((value) => value.startsWith("https://"));

export const playgroundRequestSchema = z.object({
  model: z.string().trim().min(1).max(80),
  systemPrompt: z.string().trim().max(2_000).default(""),
  prompt: z.string().trim().min(1).max(8_000),
  imageUrl: z
    .union([playgroundImageDataUrlSchema, playgroundRemoteImageUrlSchema])
    .nullable()
    .default(null),
  enableThinking: z.boolean().default(false),
  temperature: z.number().min(0).max(2).default(0.7),
  maxTokens: z.number().int().min(128).max(4_096).default(1_024),
});

export type PlaygroundRequest = z.infer<typeof playgroundRequestSchema>;

export function buildPlaygroundApiCall(
  apiBase: string,
  apiKey: string,
  input: PlaygroundRequest,
): { path: string; init: RequestInit } {
  const base = new URL(apiBase);
  const path = `${base.pathname.replace(/\/$/, "")}/chat/completions`;
  return {
    path,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildPlaygroundPayload(input)),
      cache: "no-store",
    },
  };
}

export function buildPlaygroundPayload(
  input: PlaygroundRequest,
): Record<string, unknown> {
  if (input.imageUrl && !input.model.startsWith("qwen-")) {
    throw new Error("playground_image_requires_qwen");
  }

  const userContent: string | Array<Record<string, unknown>> = input.imageUrl
    ? [
        { type: "image_url", image_url: { url: input.imageUrl } },
        { type: "text", text: input.prompt },
      ]
    : input.prompt;
  const messages: Array<Record<string, unknown>> = [];
  if (input.systemPrompt) {
    messages.push({ role: "system", content: input.systemPrompt });
  }
  messages.push({ role: "user", content: userContent });

  const payload: Record<string, unknown> = {
    model: input.model,
    messages,
    stream: false,
    temperature: input.temperature,
    max_tokens: input.maxTokens,
  };
  if (input.model.startsWith("qwen-")) {
    payload.enable_thinking = input.enableThinking;
  } else if (input.model.startsWith("deepseek-")) {
    payload.thinking = { type: input.enableThinking ? "enabled" : "disabled" };
    if (input.enableThinking) payload.reasoning_effort = "high";
  }
  return payload;
}
