import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setGatewayServiceEnabled } from "@/lib/gateway/service-state";

import { GET } from "./route";

describe.sequential("public models endpoint", () => {
  let dataDirectory: string;

  beforeEach(async () => {
    dataDirectory = await mkdtemp(path.join(tmpdir(), "modelmux-models-test-"));
    process.env.MODELMUX_DATA_DIR = dataDirectory;
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    await rm(dataDirectory, { force: true, recursive: true });
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
