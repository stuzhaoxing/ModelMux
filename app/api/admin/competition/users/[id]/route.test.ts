import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), requireSameOrigin: vi.fn(), updateUser: vi.fn() }));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/competition/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/competition/http")>(),
  requireSameOrigin: mocks.requireSameOrigin,
}));
vi.mock("@/lib/competition/repository", () => ({ updateUser: mocks.updateUser, deleteUser: vi.fn() }));

import { PATCH } from "./route";

function edit(body: unknown) {
  return PATCH(new NextRequest("http://localhost/api/admin/competition/users/42", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ id: "42" }) });
}

describe("admin account edit API", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireAdmin.mockReturnValue({});
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.updateUser.mockResolvedValue(true);
  });

  it("accepts account, password and name together without trimming the password", async () => {
    const response = await edit({ username: " User.New ", password: " new-password ", displayName: " 新姓名 " });
    expect(response.status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({ id: 42, username: "User.New", password: " new-password ", displayName: "新姓名" });
  });

  it("preserves an omitted password in partial edits", async () => {
    expect((await edit({ username: "new-user" })).status).toBe(200);
    expect(mocks.updateUser).toHaveBeenCalledWith({ id: 42, username: "new-user" });
  });

  it.each([{ username: "!bad" }, { username: "x" }, { password: "short" }, { password: "" }, { displayName: " " }, {}])("rejects invalid edits %j", async (input) => {
    expect((await edit(input)).status).toBe(400);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("reports duplicate usernames without reporting success", async () => {
    mocks.updateUser.mockRejectedValue(Object.assign(new Error("duplicate"), { code: "ER_DUP_ENTRY" }));
    const response = await edit({ username: "existing" });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "登录账号已经存在" });
  });

  it("requires an admin session", async () => {
    mocks.requireAdmin.mockReturnValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    expect((await edit({ password: "new-password" })).status).toBe(401);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it("rejects cross-origin changes", async () => {
    mocks.requireSameOrigin.mockReturnValue(NextResponse.json({ error: "forbidden" }, { status: 403 }));
    expect((await edit({ password: "new-password" })).status).toBe(403);
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });
});
