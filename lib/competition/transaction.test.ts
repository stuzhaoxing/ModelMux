import type { PoolConnection } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { withCompetitionTransaction } from "./transaction";

function fakeConnection() {
  return {
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
    release: vi.fn(),
  };
}

describe("competition transactions", () => {
  it("commits successful business and event writes", async () => {
    const connection = fakeConnection();
    await expect(withCompetitionTransaction(
      connection as unknown as PoolConnection,
      async () => "saved",
    )).resolves.toBe("saved");

    expect(connection.commit).toHaveBeenCalledOnce();
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledOnce();
  });

  it("rolls back when the event write fails", async () => {
    const connection = fakeConnection();
    const eventFailure = new Error("event insert failed");
    await expect(withCompetitionTransaction(
      connection as unknown as PoolConnection,
      async () => { throw eventFailure; },
    )).rejects.toBe(eventFailure);

    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledOnce();
    expect(connection.release).toHaveBeenCalledOnce();
  });
});
