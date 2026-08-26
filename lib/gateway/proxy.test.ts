import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  authenticateContestantApiKey,
  recordContestantTokenUsage,
  releaseContestantApiRequest,
  reserveContestantApiRequest,
} from "../competition/repository";
import { proxyChatCompletions } from "./proxy";
import { setOperationMode } from "./operation-mode";
import { setGatewayServiceEnabled } from "./service-state";

vi.mock("../competition/repository", async (importOriginal) => {
  const original = await importOriginal<typeof import("../competition/repository")>();
  return {
    ...original,
    authenticateContestantApiKey: vi.fn(),
    recordContestantTokenUsage: vi.fn(),
    reserveContestantApiRequest: vi.fn(),
    releaseContestantApiRequest: vi.fn(),
  };
});

vi.mock("../competition/activity", () => ({
  recordActivity: vi.fn(),
}));

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
  "ARK_API_KEYS",
];

function request(
  model = "deepseek-v4-pro",
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
    vi.mocked(recordContestantTokenUsage).mockResolvedValue();
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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "wrong"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(payload.error.code).toBe("service_suspended");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invalid client credentials before contacting the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "wrong"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("invalid_api_key");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts only Bearer authentication on the OpenAI-compatible API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const original = request();
    const response = await proxyChatCompletions(new Request(original.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "client-secret",
      },
      body: await original.text(),
    }));
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

  it.each([
    "deepseek",
    "qwen",
    "deepseek-flash",
    "deepseek-pro",
    "qwen-flash",
    "qwen-pro",
    "qwen-max",
    "QWEN3.7-PLUS",
  ])("rejects removed or inexact model name %s", async (model) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(request(model));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("model_not_allowed");
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
            controller.enqueue(new TextEncoder().encode('{"model":"deepseek-v4-pro","messages":[]}'));
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

  it("forwards the exact DeepSeek platform model ID without inventing parameters", async () => {
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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "client-secret", true));

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

    const original = request("qwen3.7-flash");
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

  it("routes exact Kimi K3 and GLM-5.3 IDs through DashScope", async () => {
    const requestedModels = ["kimi/kimi-k3", "ZHIPU/GLM-5.3"];
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(url).toBe(
        "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      );
      expect(requestedModels).toContain(body.model);
      return Response.json({ id: "domestic-model-response" });
    });
    vi.stubGlobal("fetch", fetchMock);

    for (const model of requestedModels) {
      const response = await proxyChatCompletions(request(model));
      expect(response.status).toBe(200);
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the Ark v3 chat completions path for the exact Doubao model", async () => {
    process.env.ARK_API_KEYS = "ark-secret";
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(url).toBe(
        "https://ark.cn-beijing.volces.com/api/v3/chat/completions",
      );
      expect(body.model).toBe("doubao-seed-2-0-pro-260215");
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer ark-secret",
      );
      return Response.json({ id: "doubao-response" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await proxyChatCompletions(
      request("doubao-seed-2-0-pro-260215"),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
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

    const original = request("deepseek-v4-pro");
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
    const original = request("deepseek-v4-pro");
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

    const response = await proxyChatCompletions(request("deepseek-v4-pro"));

    expect(response.status).toBe(200);
  });

  it("fails over before returning an upstream error", async () => {
    process.env.PRIMARY_KEYS = "primary-key";
    process.env.BACKUP_KEYS = "backup-key";
    process.env.MODELMUX_ROUTES_JSON = JSON.stringify({
      "primary-model": [
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

    const response = await proxyChatCompletions(request("primary-model"));

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
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "completion-42",
      usage: { prompt_tokens: 14, completion_tokens: 6, total_tokens: 20 },
    })));

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "sk-competition-test"));
    await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Quota-Remaining")).toBe("9");
    expect(reserveContestantApiRequest).toHaveBeenCalledWith(42, true);
    expect(releaseContestantApiRequest).not.toHaveBeenCalled();
    expect(recordContestantTokenUsage).toHaveBeenCalledWith(42, {
      inputTokens: 14,
      outputTokens: 6,
      totalTokens: 20,
    });
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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "sk-competition-test"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(429);
    expect(response.headers.get("X-Quota-Remaining")).toBe("0");
    expect(payload.error.code).toBe("quota_exceeded");
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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "sk-competition-test"));

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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "sk-competition-test"));

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

    const response = await proxyChatCompletions(request("deepseek-v4-pro", "sk-competition-test"));

    expect(response.status).toBe(400);
    expect(response.headers.get("X-Quota-Remaining")).toBe("10");
    expect(releaseContestantApiRequest).toHaveBeenCalledWith(42);
  });
});
