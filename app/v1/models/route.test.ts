import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setGatewayServiceEnabled } from "@/lib/gateway/service-state";

import { GET } from "./route";

function authenticatedRequest(): Request {
  return new Request("http://localhost:4000/v1/models", {
    headers: { Authorization: "Bearer models-test-key" },
  });
}

describe.sequential("public models endpoint", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-models-test-"));
    process.env.MODELMUX_DATA_DIR = dataDirectory;
    process.env.MODELMUX_CLIENT_KEYS = "models-test-key";
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    delete process.env.MODELMUX_CLIENT_KEYS;
    delete process.env.DASHSCOPE_API_KEYS;
    delete process.env.ARK_API_KEYS;
    await rm(dataDirectory, { force: true, recursive: true });
  });

  it("returns only exact primary-platform model IDs", async () => {
    const response = await GET(authenticatedRequest());
    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data.map((model) => model.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-flash",
      "qwen3.7-plus",
      "qwen3.7-max",
    ]);
  });

  it("advertises configured domestic flagship models with exact IDs", async () => {
    process.env.DASHSCOPE_API_KEYS = "dashscope-key";

    const response = await GET(authenticatedRequest());
    const payload = (await response.json()) as {
      data: Array<{ id: string }>;
    };

    expect(response.status).toBe(200);
    expect(payload.data.map((model) => model.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-flash",
      "qwen3.7-plus",
      "qwen3.7-max",
      "qwen3.8-max",
      "ZHIPU/GLM-5.3",
      "kimi/kimi-k3",
      "MiniMax/MiniMax-M3",
    ]);
  });

  it("rejects requests without a Bearer key", async () => {
    const response = await GET(new Request("http://localhost:4000/v1/models"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(401);
    expect(payload.error.code).toBe("invalid_api_key");
  });

  it("returns the suspended error while model service is stopped", async () => {
    await setGatewayServiceEnabled(false);

    const response = await GET(new Request("http://localhost:4000/v1/models"));
    const payload = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("3600");
    expect(payload.error.code).toBe("service_suspended");
  });
});
