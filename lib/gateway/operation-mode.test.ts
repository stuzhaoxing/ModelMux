import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  operationModeState,
  quotaEnforced,
  setOperationMode,
} from "./operation-mode";

describe.sequential("gateway operation mode", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "modelmux-operation-mode-"));
    process.env.MODELMUX_DATA_DIR = directory;
  });

  afterEach(async () => {
    delete process.env.MODELMUX_DATA_DIR;
    await rm(directory, { force: true, recursive: true });
  });

  it("defaults to the quota-enforcing test mode", async () => {
    await expect(operationModeState()).resolves.toEqual({
      mode: "test",
      updatedAt: null,
      stateFileValid: true,
    });
  });

  it("persists competition mode across subsequent reads", async () => {
    const changedAt = new Date("2026-08-19T01:00:00.000Z");

    await expect(setOperationMode("competition", changedAt)).resolves.toEqual({
      mode: "competition",
      updatedAt: changedAt.toISOString(),
      stateFileValid: true,
    });
    await expect(operationModeState()).resolves.toEqual({
      mode: "competition",
      updatedAt: changedAt.toISOString(),
      stateFileValid: true,
    });
  });

  it("falls back to limited quota when the persisted mode cannot be trusted", async () => {
    await writeFile(
      path.join(directory, "gateway-operation-mode.json"),
      '{"mode":"unlimited"}\n',
    );

    await expect(operationModeState()).resolves.toEqual({
      mode: "test",
      updatedAt: null,
      stateFileValid: false,
    });
  });

  it("only enforces the total request quota in test mode", () => {
    expect(quotaEnforced("test")).toBe(true);
    expect(quotaEnforced("competition")).toBe(false);
  });
});
