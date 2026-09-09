import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getCompetitionControl: vi.fn(), readStateFile: vi.fn() }));
vi.mock("@/lib/competition/repository", () => ({ getCompetitionControl: mocks.getCompetitionControl }));
vi.mock("./state-file", () => ({ readStateFile: mocks.readStateFile }));

import { operationModeState } from "./operation-mode";

describe("competition-driven operation mode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("MODELMUX_DATABASE_URL", "mysql://test");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to test without a competition database, ignoring legacy mode files", async () => {
    vi.stubEnv("MODELMUX_DATABASE_URL", "");
    mocks.readStateFile.mockResolvedValue({ status: "ok", value: { mode: "competition" } });
    await expect(operationModeState()).resolves.toEqual({
      mode: "test", updatedAt: null, stateFileValid: true,
    });
    expect(mocks.getCompetitionControl).not.toHaveBeenCalled();
    expect(mocks.readStateFile).not.toHaveBeenCalled();
  });

  it.each([
    ["competition", "not_started", null, "test"],
    ["test", "running", "2026-09-09T01:00:00.000Z", "test"],
    ["test", "ended", "2026-09-09T01:00:00.000Z", "test"],
    ["competition", "running", "2026-09-09T01:00:00.000Z", "competition"],
    ["competition", "ended", "2026-09-09T01:00:00.000Z", "competition"],
  ])("derives %s / %s from the persisted start", async (phase, state, startedAt, mode) => {
    mocks.getCompetitionControl.mockResolvedValue({ phase, state, startedAt });
    await expect(operationModeState()).resolves.toEqual({
      mode, updatedAt: startedAt, stateFileValid: true,
    });
  });

  it("does not invent a mode when the database is unavailable", async () => {
    mocks.getCompetitionControl.mockRejectedValue(new Error("database offline"));
    await expect(operationModeState()).rejects.toThrow("database offline");
  });
});
