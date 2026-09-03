import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute: vi.fn(),
  };
  const pool = {
    execute: vi.fn(),
    getConnection: vi.fn(async () => connection),
  };
  return {
    connection,
    pool,
    deleteStoredMediaFiles: vi.fn(),
    ensureCompetitionSchema: vi.fn(),
    hashPassword: vi.fn(async () => "password-hash"),
  };
});

vi.mock("./db", () => ({
  competitionPool: () => mocks.pool,
  ensureCompetitionSchema: mocks.ensureCompetitionSchema,
  rows: vi.fn(),
}));

vi.mock("./auth", () => ({
  hashPassword: mocks.hashPassword,
}));

vi.mock("./media", () => ({
  deleteStoredMediaFiles: mocks.deleteStoredMediaFiles,
}));

import { createUser, deleteUser } from "./repository";

describe("competition account hard deletion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.execute.mockReset();
    mocks.pool.execute.mockReset();
    mocks.connection.beginTransaction.mockResolvedValue(undefined);
    mocks.connection.commit.mockResolvedValue(undefined);
    mocks.connection.rollback.mockResolvedValue(undefined);
    mocks.connection.release.mockReturnValue(undefined);
    mocks.deleteStoredMediaFiles.mockResolvedValue(undefined);
  });

  it("permanently deletes a contestant and all account-owned data", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{ id: 17 }]])
      .mockResolvedValueOnce([[
        { storage_name: "first.upload" },
        { storage_name: "second.png" },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 3 }])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(deleteUser(17)).resolves.toBe(true);

    expect(String(mocks.connection.execute.mock.calls[2][0])).toContain("DELETE FROM competition_answers");
    expect(String(mocks.connection.execute.mock.calls[3][0])).toContain("DELETE FROM competition_attachments");
    expect(String(mocks.connection.execute.mock.calls[4][0])).toContain("DELETE FROM competition_users");
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).not.toHaveBeenCalled();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
    expect(mocks.deleteStoredMediaFiles).toHaveBeenCalledWith(["first.upload", "second.png"]);
  });

  it("purges an old soft-deleted row before recreating the same username", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{ id: 9 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([{ affectedRows: 0 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);
    mocks.pool.execute.mockResolvedValueOnce([{ insertId: 42 }]);

    await expect(createUser({
      role: "contestant",
      username: " XuanShou ",
      displayName: "新选手",
      password: "new-password",
    })).resolves.toBe(42);

    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("deleted_at IS NOT NULL");
    expect(mocks.connection.execute.mock.calls[0][1]).toEqual(["xuanshou"]);
    expect(mocks.pool.execute.mock.calls[0][1]).toEqual([
      "contestant",
      "xuanshou",
      "新选手",
      "password-hash",
      "new-password",
      expect.stringMatching(/^sk-competition-/),
    ]);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });
});
