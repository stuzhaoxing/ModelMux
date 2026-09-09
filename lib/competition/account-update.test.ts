import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), execute: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  competitionPool: () => ({ getConnection: async () => mocks.connection }),
  ensureCompetitionSchema: vi.fn(),
  rows: vi.fn(),
}));

import { verifyPassword } from "./auth";
import { updateUser } from "./repository";

describe("contestant account edits", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.connection.execute.mockResolvedValue([{ affectedRows: 1 }]);
  });

  it("updates login and displayed credentials together and revokes the old sessions", async () => {
    const password = " New-Password-123 ";
    await expect(updateUser({ id: 42, username: " Renamed.User ", password, displayName: " 新姓名 " })).resolves.toBe(true);

    const [sql, values] = mocks.connection.execute.mock.calls[0];
    expect(sql).toContain("username = ?, password_hash = ?, event_password = ?, display_name = ?");
    expect(sql).toContain("WHERE id = ? AND role = 'contestant' AND deleted_at IS NULL");
    expect(values).toEqual(["renamed.user", expect.stringMatching(/^scrypt\$/), password, "新姓名", 42]);
    await expect(verifyPassword(password, values[1])).resolves.toBe(true);
    await expect(verifyPassword("old-password", values[1])).resolves.toBe(false);
    expect(sql).not.toContain("api_key");
    expect(mocks.connection.execute.mock.calls[1][0]).toContain("UPDATE competition_sessions SET revoked_at");
    expect(mocks.connection.execute.mock.calls[1][1]).toEqual([42]);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
  });

  it("keeps passwords and sessions when only the display name changes", async () => {
    await expect(updateUser({ id: 42, displayName: "新姓名" })).resolves.toBe(true);
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.execute.mock.calls[0][0]).not.toContain("password");
  });

  it("revokes sessions when the account is disabled", async () => {
    await updateUser({ id: 42, active: false });
    expect(mocks.connection.execute).toHaveBeenCalledTimes(2);
  });

  it("does not revoke sessions for a missing, deleted or non-contestant account", async () => {
    mocks.connection.execute.mockResolvedValueOnce([{ affectedRows: 0 }]);
    await expect(updateUser({ id: 42, username: "new-user" })).resolves.toBe(false);
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
  });

  it("rolls back all changes if the username already exists", async () => {
    const duplicate = Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" });
    mocks.connection.execute.mockRejectedValueOnce(duplicate);
    await expect(updateUser({ id: 42, username: "existing", password: "new-password" })).rejects.toBe(duplicate);
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back credential changes when session revocation fails", async () => {
    mocks.connection.execute.mockResolvedValueOnce([{ affectedRows: 1 }]).mockRejectedValueOnce(new Error("write failed"));
    await expect(updateUser({ id: 42, password: "new-password" })).rejects.toThrow("write failed");
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
  });
});
