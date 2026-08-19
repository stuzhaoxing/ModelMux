import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticateContestantApiKey,
  releaseContestantApiRequest,
  reserveContestantApiRequest,
} from "../competition/repository";
import {
  proxyAnthropicMessages,
  proxyChatCompletions,
} from "./proxy";
import { setOperationMode } from "./operation-mode";
import { setGatewayServiceEnabled } from "./service-state";

vi.mock("../competition/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../competition/repository")>();
  return {
    ...original,
    authenticateContestantApiKey: vi.fn(),
    reserveContestantApiRequest: vi.fn(),
    releaseContestantApiRequest: vi.fn(),
  };
});

const ENV_KEYS = [
  "MODELMUX_ALLOW_ANONYMOUS",
  "MODELMUX_CLIENT_KEYS",
  "MODELMUX_DATA_DIR",
  "MODELMUX_DATABASE_URL",
  "MODELMUX_MAX_BODY_BYTES",
  "MODELMUX_RATE_LIMIT_RPM",
  "MODELMUX_ROUTES_JSON",
  "DEEPSEEK_API_KEYS",
  "DASHSCOPE_API_KEYS",
  "SILICONFLOW_API_KEYS",
];

function request(
  model = "deepseek",
  key = "client-secret",
  stream = false,
): Request {
  return new Request("http://localhost:4000/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hello" }],
      stream,
    }),
  });
}

function anthropicRequest(
  mode: "text" | "image",
  options?: {
    stream?: boolean;
    key?: string;
    model?: string;
    includeVersion?: boolean;
  },
): Request {
  const content = mode === "text"
    ? "hello"
    : [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: "aGVsbG8=",
          },
        },
        { type: "text", text: "describe this image" },
      ];
  return new Request("http://localhost:4000/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": options?.key ?? "client-secret",
      "Content-Type": "application/json",
      ...(options?.includeVersion === false
        ? {}
        : { "anthropic-version": "2023-06-01" }),
    },
    body: JSON.stringify({
      model: options?.model ?? "qwen-flash",
      max_tokens: 128,
      system: "Answer briefly.",
      messages: [{ role: "user", content }],
      stream: options?.stream === true,
    }),
  });
}

describe.sequential("chat completion proxy", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-proxy-test-"));
    process.env.MODELMUX_DATA_DIR = dataDirectory;
    process.env.MODELMUX_CLIENT_KEYS = "client-secret";
    process.env.DEEPSEEK_API_KEYS = "deepseek-secret";
    process.env.DASHSCOPE_API_KEYS = "dashscope-secret";
    process.env.SILICONFLOW_API_KEYS = "provider-secret";
    process.env.MODELMUX_RATE_LIMIT_RPM = "60";
    vi.mocked(authenticateContestantApiKey).mockResolvedValue(null);
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({ allowed: true, remaining: 9 });
    vi.mocked(releaseContestantApiRequest).mockResolvedValue();
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    for (const key of ENV_KEYS) delete process.env[key];
    await rm(dataDirectory, { force: true, recursive: true });
  });

  it("rejects new requests before authentication when service is stopped", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await setGatewayServiceEnabled(false);

    const response = await proxyChatCompletions(request("deepseek", "wrong"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(payload.error.code).toBe("service_suspended");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid client credentials before contacting the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request("deepseek", "wrong"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("invalid_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects models outside the competition whitelist", async () => {
    vi.stubGlobal("fetch", vi.fn());

    const response = await proxyChatCompletions(request("unapproved-model"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("model_not_allowed");
  });

  it("does not accept an upstream model id as a public model", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(
      request("deepseek-v4-pro"),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops chunked request bodies at the configured byte limit", async () => {
    process.env.MODELMUX_MAX_BODY_BYTES = "16";
    vi.stubGlobal("fetch", vi.fn());
    const oversized = new Request(
      "http://localhost:4000/v1/chat/completions",
      {
        method: "POST",
        headers: { Authorization: "Bearer client-secret" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"model":"deepseek","messages":[]}'));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await proxyChatCompletions(oversized);
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(413);
    expect(payload.error.code).toBe("request_too_large");
    delete process.env.MODELMUX_MAX_BODY_BYTES;
  });

  it("maps the legacy deepseek alias to Pro without inventing parameters", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe("deepseek-v4-pro");
      expect(body.thinking).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer deepseek-secret",
      );
      return new Response("data: ok\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request("deepseek", "client-secret", true));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    expect(await response.text()).toBe("data: ok\n\n");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("preserves official Qwen thinking parameters through DashScope", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(url).toBe(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      );
      expect(body.model).toBe("qwen3.7-flash");
      expect(body.enable_thinking).toBe(true);
      expect(body.thinking_budget).toBe(8192);
      expect(body.thinking).toBeUndefined();
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer dashscope-secret",
      );
      return Response.json({ id: "qwen-flash-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const original = request("qwen-flash");
    const payload = await original.json() as Record<string, unknown>;
    payload.enable_thinking = true;
    payload.thinking_budget = 8192;
    const response = await proxyChatCompletions(
      new Request(original.url, {
        method: "POST",
        headers: original.headers,
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("preserves official DeepSeek V4 thinking parameters", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe("deepseek-v4-pro");
      expect(body.thinking).toEqual({ type: "enabled" });
      expect(body.reasoning_effort).toBe("max");
      return Response.json({ id: "deepseek-pro-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const original = request("deepseek-pro");
    const payload = await original.json() as Record<string, unknown>;
    payload.thinking = { type: "enabled" };
    payload.reasoning_effort = "max";
    const response = await proxyChatCompletions(
      new Request(original.url, {
        method: "POST",
        headers: original.headers,
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(200);
  });

  it("rejects unofficial parameters before contacting an upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const original = request("deepseek-pro");
    const payload = await original.json() as Record<string, unknown>;
    payload.enable_thinking = true;

    const response = await proxyChatCompletions(
      new Request(original.url, {
        method: "POST",
        headers: original.headers,
        body: JSON.stringify(payload),
      }),
    );

    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps DeepSeek thinking semantics on SiliconFlow failover", async () => {
    delete process.env.DEEPSEEK_API_KEYS;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.model).toBe("Pro/deepseek-ai/DeepSeek-V3.2");
      expect(body.enable_thinking).toBe(true);
      expect(body.thinking).toBeUndefined();
      expect(body.reasoning_effort).toBeUndefined();
      return Response.json({ id: "siliconflow-deepseek-1" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request("deepseek-pro"));

    expect(response.status).toBe(200);
  });

  it("fails over before returning an upstream error", async () => {
    process.env.PRIMARY_KEYS = "primary-key";
    process.env.BACKUP_KEYS = "backup-key";
    process.env.MODELMUX_ROUTES_JSON = JSON.stringify({
      deepseek: [
        {
          provider: "primary",
          baseUrl: "https://primary.example.com",
          upstreamModel: "primary-model",
          apiKeyEnv: "PRIMARY_KEYS",
          priority: 100,
        },
        {
          provider: "backup",
          baseUrl: "https://backup.example.com",
          upstreamModel: "backup-model",
          apiKeyEnv: "BACKUP_KEYS",
          priority: 80,
        },
      ],
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 503 }))
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body.model).toBe("backup-model");
        return Response.json({ id: "completion-1" }, { status: 200 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-ModelMux-Provider")).toBe("backup");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    delete process.env.PRIMARY_KEYS;
    delete process.env.BACKUP_KEYS;
  });

  it("returns a stable error when no provider key is configured", async () => {
    delete process.env.DEEPSEEK_API_KEYS;
    delete process.env.SILICONFLOW_API_KEYS;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request());
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(payload.error.code).toBe("provider_not_configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deducts a successful request from a contestant quota", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 0,
    });
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({ allowed: true, remaining: 9 });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "completion-42" })));

    const response = await proxyChatCompletions(request("deepseek", "sk-competition-test"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Quota-Remaining")).toBe("9");
    expect(reserveContestantApiRequest).toHaveBeenCalledWith(42, true);
    expect(releaseContestantApiRequest).not.toHaveBeenCalled();
  });

  it("rejects exhausted contestant quota before contacting a provider", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 10,
    });
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({ allowed: false, remaining: 0 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request("deepseek", "sk-competition-test"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(response.headers.get("X-Quota-Remaining")).toBe("0");
    expect(payload.error.code).toBe("quota_exceeded");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("serves Anthropic Messages through the same contestant quota", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 0,
    });
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      const headers = new Headers(init.headers);
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
      expect(body).toMatchObject({
        model: "deepseek-v4-pro",
        messages: [
          { role: "system", content: "Answer briefly." },
          { role: "user", content: "hello" },
        ],
        max_tokens: 128,
        stream: false,
      });
      expect(headers.get("Authorization")).toBe("Bearer deepseek-secret");
      expect(headers.get("x-api-key")).toBeNull();
      expect(headers.get("anthropic-version")).toBeNull();
      return Response.json({
        choices: [{
          message: { role: "assistant", content: "你好" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyAnthropicMessages(
      anthropicRequest("text", {
        key: "sk-competition-test",
        model: "deepseek-pro",
      }),
    );
    const payload = await response.json() as {
      type: string;
      model: string;
      content: Array<{ type: string; text: string }>;
      usage: { input_tokens: number; output_tokens: number };
    };

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Quota-Remaining")).toBe("9");
    expect(payload).toMatchObject({
      type: "message",
      model: "deepseek-pro",
      content: [{ type: "text", text: "你好" }],
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    expect(reserveContestantApiRequest).toHaveBeenCalledWith(42, true);
  });

  it("maps Anthropic image blocks to OpenAI-compatible Qwen parts", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as {
        messages: Array<{ content: Array<Record<string, unknown>> }>;
      };
      expect(body.messages[1].content).toEqual([
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64,aGVsbG8=" },
        },
        { type: "text", text: "describe this image" },
      ]);
      return Response.json({
        choices: [{
          message: { role: "assistant", content: "一张示例图片" },
          finish_reason: "stop",
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyAnthropicMessages(anthropicRequest("image"));
    const payload = await response.json() as {
      content: Array<{ type: string; text: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.content).toEqual([
      { type: "text", text: "一张示例图片" },
    ]);
  });

  it("maps Anthropic tools and OpenAI tool calls in both directions", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.tools).toEqual([{
        type: "function",
        function: {
          name: "lookup",
          description: "Lookup a value",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
            required: ["query"],
          },
        },
      }]);
      return Response.json({
        choices: [{
          message: {
            role: "assistant",
            content: "",
            tool_calls: [{
              id: "call_1",
              type: "function",
              function: {
                name: "lookup",
                arguments: "{\"query\":\"air\"}",
              },
            }],
          },
          finish_reason: "tool_calls",
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const original = anthropicRequest("text");
    const body = await original.json() as Record<string, unknown>;
    body.tools = [{
      name: "lookup",
      description: "Lookup a value",
      input_schema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    }];

    const response = await proxyAnthropicMessages(new Request(original.url, {
      method: "POST",
      headers: original.headers,
      body: JSON.stringify(body),
    }));
    const payload = await response.json() as {
      content: Array<Record<string, unknown>>;
      stop_reason: string;
    };

    expect(payload.content).toEqual([{
      type: "tool_use",
      id: "call_1",
      name: "lookup",
      input: { query: "air" },
    }]);
    expect(payload.stop_reason).toBe("tool_use");
  });

  it("converts OpenAI SSE into Anthropic Messages events", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.stream).toBe(true);
      expect(body.stream_options).toEqual({ include_usage: true });
      return new Response([
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"你\"},\"finish_reason\":null}]}",
        "",
        "data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":4,\"completion_tokens\":2,\"total_tokens\":6}}",
        "",
        "data: [DONE]",
        "",
      ].join("\n"), {
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyAnthropicMessages(
      anthropicRequest("text", { stream: true }),
    );
    const events = (await response.text())
      .split("\n\n")
      .filter(Boolean)
      .map((block) => ({
        name: block.split("\n")[0].slice("event: ".length),
        data: JSON.parse(
          block.split("\n").find((line) => line.startsWith("data: "))!
            .slice("data: ".length),
        ) as Record<string, unknown>,
      }));

    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(events.map((item) => item.name)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ]);
    expect(events[2].data).toMatchObject({
      delta: { type: "text_delta", text: "你" },
    });
    expect(events[3].data).toMatchObject({
      delta: { type: "text_delta", text: "好" },
    });
    expect(events[5].data).toMatchObject({
      delta: { stop_reason: "end_turn" },
      usage: { input_tokens: 4, output_tokens: 2 },
    });
  });

  it("returns an Anthropic error when anthropic-version is missing", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyAnthropicMessages(
      anthropicRequest("text", { includeVersion: false }),
    );
    const payload = await response.json() as {
      type: string;
      error: { type: string; message: string };
    };

    expect(response.status).toBe(400);
    expect(payload.type).toBe("error");
    expect(payload.error.type).toBe("invalid_request_error");
    expect(payload.error.message).toContain("anthropic-version");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stops enforcing the total quota in competition mode", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    await setOperationMode("competition");
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 10,
    });
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({
      allowed: true,
      remaining: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "completion-42" })));

    const response = await proxyChatCompletions(request("deepseek", "sk-competition-test"));

    expect(response.status).toBe(200);
    expect(reserveContestantApiRequest).toHaveBeenCalledWith(42, false);
    expect(response.headers.get("X-ModelMux-Mode")).toBe("competition");
    expect(response.headers.get("X-Quota-Remaining")).toBeNull();
  });

  it("keeps the unlimited quota unchanged when the provider rejects the request", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    await setOperationMode("competition");
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 10,
    });
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({
      allowed: true,
      remaining: null,
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid", { status: 400 })));

    const response = await proxyChatCompletions(request("deepseek", "sk-competition-test"));

    expect(response.status).toBe(400);
    expect(releaseContestantApiRequest).toHaveBeenCalledWith(42);
    expect(response.headers.get("X-Quota-Remaining")).toBeNull();
  });

  it("refunds a contestant reservation when the provider rejects the request", async () => {
    process.env.MODELMUX_DATABASE_URL = "mysql://configured-for-test";
    vi.mocked(authenticateContestantApiKey).mockResolvedValue({
      id: 42,
      username: "contestant-42",
      displayName: "选手 42",
      apiKey: "sk-competition-test",
      requestQuota: 10,
      requestsUsed: 0,
    });
    vi.mocked(reserveContestantApiRequest).mockResolvedValue({ allowed: true, remaining: 9 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("invalid", { status: 400 })));

    const response = await proxyChatCompletions(request("deepseek", "sk-competition-test"));

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Quota-Remaining")).toBe("10");
    expect(releaseContestantApiRequest).toHaveBeenCalledWith(42);
  });
});
