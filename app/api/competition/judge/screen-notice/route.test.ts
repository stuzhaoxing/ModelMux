import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCompetitionScreenNotice: vi.fn(),
  updateCompetitionScreenNotice: vi.fn(),
  requireJudgeOperator: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

vi.mock("@/lib/competition/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/competition/http")>(),
  requireJudgeOperator: mocks.requireJudgeOperator,
  requireSameOrigin: mocks.requireSameOrigin,
}));

vi.mock("@/lib/competition/repository", () => ({
  getCompetitionScreenNotice: mocks.getCompetitionScreenNotice,
  updateCompetitionScreenNotice: mocks.updateCompetitionScreenNotice,
}));

import { GET, PATCH } from "./route";

const notice = {
  title: "接口信息",
  content: "API Base URL\nhttp://10.0.0.8:1444/v1",
  enabled: true,
  updatedAt: "2026-08-29 10:00:00.000",
};

describe("judge screen notice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requireJudgeOperator.mockReturnValue({
      id: null,
      role: "judge",
      username: "admin",
      displayName: "管理员",
    });
    mocks.getCompetitionScreenNotice.mockResolvedValue(notice);
    mocks.updateCompetitionScreenNotice.mockResolvedValue(notice);
  });

  it("returns the persisted notice without caching", async () => {
    const response = await GET(new NextRequest("http://localhost/api/competition/judge/screen-notice"));

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ notice });
  });

  it("trims and saves an enabled notice", async () => {
    const response = await PATCH(new NextRequest(
      "http://localhost/api/competition/judge/screen-notice",
      {
        method: "PATCH",
        body: JSON.stringify({
          title: "  接口信息  ",
          content: "  API Base URL\nhttp://10.0.0.8:1444/v1  ",
          enabled: true,
        }),
      },
    ));

    expect(response.status).toBe(200);
    expect(mocks.updateCompetitionScreenNotice).toHaveBeenCalledWith({
      title: "接口信息",
      content: "API Base URL\nhttp://10.0.0.8:1444/v1",
      enabled: true,
    });
  });

  it("rejects an enabled notice without content and blocks cross-origin writes", async () => {
    const invalid = await PATCH(new NextRequest(
      "http://localhost/api/competition/judge/screen-notice",
      {
        method: "PATCH",
        body: JSON.stringify({ title: "接口信息", content: "", enabled: true }),
      },
    ));
    expect(invalid.status).toBe(400);
    expect(mocks.updateCompetitionScreenNotice).not.toHaveBeenCalled();

    mocks.requireSameOrigin.mockReturnValue(NextResponse.json({ error: "请求来源无效" }, { status: 403 }));
    const forbidden = await PATCH(new NextRequest(
      "http://localhost/api/competition/judge/screen-notice",
      {
        method: "PATCH",
        body: JSON.stringify({ title: "接口信息", content: "正文", enabled: false }),
      },
    ));
    expect(forbidden.status).toBe(403);
  });

  it("rejects public notice content longer than the display-safe limit", async () => {
    const response = await PATCH(new NextRequest(
      "http://localhost/api/competition/judge/screen-notice",
      {
        method: "PATCH",
        body: JSON.stringify({ title: "接口信息", content: "提".repeat(301), enabled: false }),
      },
    ));

    expect(response.status).toBe(400);
    expect(mocks.updateCompetitionScreenNotice).not.toHaveBeenCalled();
  });
});
