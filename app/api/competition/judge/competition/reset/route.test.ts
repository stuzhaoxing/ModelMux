import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ operator: vi.fn(), origin: vi.fn(), reset: vi.fn(), restore: vi.fn(), list: vi.fn(), get: vi.fn() }));
vi.mock("@/lib/competition/http", async (original) => ({ ...await original<typeof import("@/lib/competition/http")>(), requireJudgeOperator: mocks.operator, requireSameOrigin: mocks.origin }));
vi.mock("@/lib/competition/archives", () => ({ resetCompetitionAnswers: mocks.reset, restoreCompetitionArchive: mocks.restore, listCompetitionArchives: mocks.list, getCompetitionArchive: mocks.get }));
import { POST } from "./route";
import { POST as restore } from "../archives/[id]/restore/route";
import { GET as list } from "../archives/route";
import { GET as download } from "../archives/[id]/route";
const context = { params: Promise.resolve({ id: "archive-1" }) };
function request(body: unknown, method = "POST") {
  return new NextRequest("http://localhost/api/competition/judge/competition/reset", { method, ...(method === "POST" ? { body: JSON.stringify(body) } : {}) });
}
describe("competition archive authorization and confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.origin.mockReturnValue(null);
    mocks.operator.mockReturnValue({ displayName: "管理员" });
    mocks.reset.mockResolvedValue({ archiveId: "archive-1", generation: 4 });
    mocks.restore.mockResolvedValue({ archiveId: "backup-2", generation: 4 });
    mocks.list.mockResolvedValue([]);
    mocks.get.mockResolvedValue({ archive: { id: "archive-1" }, snapshot: {} });
  });
  it("requires admin authentication for reset, restore, list and download", async () => {
    mocks.operator.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(request({}))).status).toBe(401);
    expect((await restore(request({}), context)).status).toBe(401);
    expect((await list(request(null, "GET"))).status).toBe(401);
    expect((await download(request(null, "GET"), context)).status).toBe(401);
    for (const fn of [mocks.reset, mocks.restore, mocks.list, mocks.get]) expect(fn).not.toHaveBeenCalled();
  });
  it("rejects cross-origin writes before accessing archives", async () => {
    mocks.origin.mockReturnValue(NextResponse.json({}, { status: 403 }));
    expect((await POST(request({ confirmation: "归档并重置", generation: 3 }))).status).toBe(403);
    expect((await restore(request({ confirmation: "恢复归档", generation: 3 }), context)).status).toBe(403);
    expect(mocks.reset).not.toHaveBeenCalled();
    expect(mocks.restore).not.toHaveBeenCalled();
  });
  it.each([{}, { confirmation: "reset", generation: 3 }, { confirmation: "归档并重置" }, { confirmation: "归档并重置", generation: -1 }])("rejects incomplete or unconfirmed resets %j", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.reset).not.toHaveBeenCalled();
  });
  it("passes the confirmed generation and admin identity to the atomic operation", async () => {
    expect((await POST(request({ confirmation: "归档并重置", generation: 3 }))).status).toBe(200);
    expect(mocks.reset).toHaveBeenCalledWith(3, "管理员");
    expect((await restore(request({ confirmation: "恢复归档", generation: 3 }), context)).status).toBe(200);
    expect(mocks.restore).toHaveBeenCalledWith("archive-1", 3, "管理员");
  });
  it.each(["archive_running", "competition_generation_changed", "archive_incompatible"])("returns a conflict for %s", async (error) => {
    mocks.reset.mockRejectedValueOnce(new Error(error));
    expect((await POST(request({ confirmation: "归档并重置", generation: 3 }))).status).toBe(409);
  });
  it("serves administrator-only snapshots as uncached attachments", async () => {
    const response = await download(request(null, "GET"), context);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    expect((await response.json()).formatVersion).toBe(1);
  });
});
