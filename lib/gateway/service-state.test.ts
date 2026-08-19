import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  gatewayServiceState,
  setGatewayServiceEnabled,
} from "./service-state";

describe.sequential("gateway service state", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "modelmux-service-state-"));
    process.env.MODELMUX_DATA_DIR = directory;
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    await rm(directory, { force: true, recursive: true });
  });

  it("defaults to enabled before an administrator changes the state", async () => {
    await expect(gatewayServiceState()).resolves.toEqual({
      enabled: true,
      updatedAt: null,
      stateFileValid: true,
    });
  });

  it("persists a stopped state across subsequent reads", async () => {
    const changedAt = new Date("2026-08-13T02:30:00.000Z");

    await expect(
      setGatewayServiceEnabled(false, changedAt),
    ).resolves.toEqual({
      enabled: false,
      updatedAt: changedAt.toISOString(),
      stateFileValid: true,
    });
    await expect(gatewayServiceState()).resolves.toEqual({
      enabled: false,
      updatedAt: changedAt.toISOString(),
      stateFileValid: true,
    });
  });

  it("fails closed when the persisted state cannot be trusted", async () => {
    await writeFile(
      path.join(directory, "gateway-service-state.json"),
      '{"enabled":"yes"}\n',
    );

    await expect(gatewayServiceState()).resolves.toEqual({
      enabled: false,
      updatedAt: null,
      stateFileValid: false,
    });
  });
});
