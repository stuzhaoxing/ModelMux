import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createQuestion: vi.fn(),
  getQuestion: vi.fn(),
  recordActivity: vi.fn(),
  requireJudgeOperator: vi.fn(),
  requireSameOrigin: vi.fn(),
}));

vi.mock("@/lib/competition/http", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/competition/http")>(),
  requireJudgeOperator: mocks.requireJudgeOperator,
  requireSameOrigin: mocks.requireSameOrigin,
}));

vi.mock("@/lib/competition/repository", () => ({
  createQuestion: mocks.createQuestion,
  getCompetitionControl: vi.fn(),
  getQuestion: mocks.getQuestion,
  listJudgeQuestions: vi.fn(),
}));

vi.mock("@/lib/competition/activity", () => ({
  recordActivity: mocks.recordActivity,
}));

import { POST } from "./route";

describe("judge question creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSameOrigin.mockReturnValue(null);
    mocks.requireJudgeOperator.mockReturnValue({
      id: null,
      role: "judge",
      username: "admin",
      displayName: "管理员",
    });
  });

  it("rejects titles longer than 50 characters before writing", async () => {
    const response = await POST(new NextRequest("http://localhost/api/competition/judge/questions", {
      method: "POST",
      body: JSON.stringify({ title: "题".repeat(51), contentHtml: "<p>正文</p>" }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "题目标题不能超过 50 字" });
    expect(mocks.createQuestion).not.toHaveBeenCalled();
  });

  it("accepts a 50-character title", async () => {
    const title = "题".repeat(50);
    mocks.createQuestion.mockResolvedValue(12);
    mocks.getQuestion.mockResolvedValue({ id: 12, title, contentHtml: "<p>正文</p>" });

    const response = await POST(new NextRequest("http://localhost/api/competition/judge/questions", {
      method: "POST",
      body: JSON.stringify({ title, contentHtml: "<p>正文</p>" }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createQuestion).toHaveBeenCalledWith({ authorId: null, title, contentHtml: "<p>正文</p>" });
  });
});
