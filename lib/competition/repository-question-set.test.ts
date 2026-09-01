import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const connection = {
    beginTransaction: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
    execute: vi.fn(),
  };
  return {
    connection,
    ensureCompetitionSchema: vi.fn(),
    insertCompetitionEvent: vi.fn(),
  };
});

vi.mock("./db", () => ({
  competitionPool: () => ({ getConnection: async () => mocks.connection }),
  ensureCompetitionSchema: mocks.ensureCompetitionSchema,
  rows: vi.fn(),
}));

vi.mock("./events", () => ({
  insertCompetitionEvent: mocks.insertCompetitionEvent,
}));

import {
  createQuestion,
  deleteQuestionWhileStopped,
  saveAnswer,
  startCompetition,
  stopCompetition,
  updateQuestion,
} from "./repository";

describe("competition question set publishing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.execute.mockReset();
    mocks.connection.beginTransaction.mockResolvedValue(undefined);
    mocks.connection.commit.mockResolvedValue(undefined);
    mocks.connection.rollback.mockResolvedValue(undefined);
    mocks.connection.release.mockReturnValue(undefined);
  });

  it("starts a timed competition and opens every question in one transaction", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{ status: "not_started", duration_minutes: 90, started_at: null, ends_at: null, stopped_at: null, active: 0 }]])
      .mockResolvedValueOnce([[{ id: 1, title: "第一题", status: "draft" }, { id: 2, title: "第二题", status: "draft" }]])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ status: "running", duration_minutes: 60, started_at: "2020-08-25 16:00:00.000", ends_at: "2030-08-25 17:00:00.000", stopped_at: null, active: 1 }]]);

    await expect(startCompetition(60)).resolves.toMatchObject({
      questionCount: 2,
      competition: { state: "running", durationMinutes: 60 },
    });
    expect(mocks.connection.beginTransaction).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).not.toHaveBeenCalled();
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("competition_control");
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(String(mocks.connection.execute.mock.calls[2][0])).toContain("status = 'published'");
    expect(String(mocks.connection.execute.mock.calls[3][0])).toContain("status = 'running'");
    expect(mocks.connection.execute.mock.calls[3][1]).toEqual([60, 60]);
    expect(mocks.insertCompetitionEvent).toHaveBeenCalledTimes(2);
    expect(mocks.insertCompetitionEvent).toHaveBeenNthCalledWith(1, mocks.connection, { type: "question-updated", questionId: 1 });
    expect(mocks.insertCompetitionEvent).toHaveBeenNthCalledWith(2, mocks.connection, { type: "question-updated", questionId: 2 });
  });

  it("restarts a stopped competition without deleting existing answers", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{ status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 }]])
      .mockResolvedValueOnce([[
        { id: 1, title: "第一题", status: "published" },
        { id: 2, title: "第二题", status: "closed" },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 2 }])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ status: "running", duration_minutes: 30, started_at: "2020-08-25 16:30:00.000", ends_at: "2030-08-25 17:00:00.000", stopped_at: null, active: 1 }]]);

    await expect(startCompetition(30)).resolves.toMatchObject({ questionCount: 2, competition: { state: "running" } });
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.insertCompetitionEvent).toHaveBeenCalledTimes(2);
  });

  it("allows appending a new question after the competition has stopped", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[
        { status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 },
      ]])
      .mockResolvedValueOnce([{ insertId: 13 }]);

    await expect(createQuestion({ authorId: 9, title: "追加题", contentHtml: "<p>内容</p>" }))
      .resolves.toBe(13);
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("competition_control");
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it("refuses to append a new question while the competition is running", async () => {
    mocks.connection.execute.mockResolvedValueOnce([[
      { status: "running", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 17:00:00.000", stopped_at: null, active: 1 },
    ]]);

    await expect(createQuestion({ authorId: 9, title: "追加题", contentHtml: "<p>内容</p>" }))
      .rejects.toThrow("competition_running");
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
  });

  it("creates an admin-authored question without a competition user", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[
        { status: "not_started", duration_minutes: 90, started_at: null, ends_at: null, stopped_at: null, active: 0 },
      ]])
      .mockResolvedValueOnce([{ insertId: 12 }]);

    await expect(createQuestion({
      authorId: null,
      title: "管理员出题",
      contentHtml: "<p>内容</p>",
    })).resolves.toBe(12);

    expect(mocks.connection.execute.mock.calls[1][1]).toEqual([
      "管理员出题",
      "<p>内容</p>",
      null,
    ]);
    expect(mocks.insertCompetitionEvent).toHaveBeenCalledWith(
      mocks.connection,
      { type: "question-updated", questionId: 12 },
    );
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it("allows updating a published question after the competition has stopped", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[
        { status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(updateQuestion({
      id: 5,
      title: "赛后修改",
      contentHtml: "<p>新内容</p>",
      expectedVersion: 2,
    })).resolves.toBe(true);
    expect(String(mocks.connection.execute.mock.calls[1][0])).not.toContain("status = 'draft'");
    expect(mocks.insertCompetitionEvent).toHaveBeenCalledWith(
      mocks.connection,
      { type: "question-updated", questionId: 5 },
    );
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it("refuses to update a question while the competition is running", async () => {
    mocks.connection.execute.mockResolvedValueOnce([[
      { status: "running", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 17:00:00.000", stopped_at: null, active: 1 },
    ]]);

    await expect(updateQuestion({
      id: 5,
      title: "比赛中修改",
      contentHtml: "<p>内容</p>",
      expectedVersion: 2,
    })).rejects.toThrow("competition_running");
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
  });

  it("deletes a question and its answers before the competition starts", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[
        { status: "not_started", duration_minutes: 90, started_at: null, ends_at: null, stopped_at: null, active: 0 },
      ]])
      .mockResolvedValueOnce([[
        { id: 3, title: "待删除题目", status: "published" },
      ]])
      .mockResolvedValueOnce([[
        { answer_count: 2 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(deleteQuestionWhileStopped(3)).resolves.toEqual({
      title: "待删除题目",
      answerCount: 2,
    });
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("competition_control");
    expect(String(mocks.connection.execute.mock.calls[0][0])).toContain("FOR UPDATE");
    expect(String(mocks.connection.execute.mock.calls[3][0])).toContain("DELETE FROM competition_questions");
    expect(mocks.connection.execute.mock.calls[3][1]).toEqual([3]);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).not.toHaveBeenCalled();
  });

  it("allows deleting a question after the competition has stopped", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[
        { status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 },
      ]])
      .mockResolvedValueOnce([[
        { id: 4, title: "赛后删除题目", status: "published" },
      ]])
      .mockResolvedValueOnce([[
        { answer_count: 0 },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }]);

    await expect(deleteQuestionWhileStopped(4)).resolves.toEqual({
      title: "赛后删除题目",
      answerCount: 0,
    });
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
  });

  it("refuses to delete a question while the competition is running", async () => {
    mocks.connection.execute.mockResolvedValueOnce([[
      { status: "running", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 17:00:00.000", stopped_at: null, active: 1 },
    ]]);

    await expect(deleteQuestionWhileStopped(3)).rejects.toThrow("competition_running");
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
  });

  it("stops a running competition while preserving questions and answers", async () => {
    mocks.connection.execute
      .mockResolvedValueOnce([[{ status: "running", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 17:00:00.000", stopped_at: null, active: 1 }]])
      .mockResolvedValueOnce([[
        { id: 1, title: "第一题", status: "published" },
        { id: 2, title: "第二题", status: "published" },
      ]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])
      .mockResolvedValueOnce([[{ status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 }]]);

    await expect(stopCompetition()).resolves.toMatchObject({
      questionCount: 2,
      competition: { state: "ended" },
    });
    expect(String(mocks.connection.execute.mock.calls[2][0])).toContain("status = 'ended'");
    expect(mocks.connection.execute.mock.calls.some(([statement]) => String(statement).includes("competition_answers"))).toBe(false);
    expect(mocks.connection.commit).toHaveBeenCalledOnce();
    expect(mocks.insertCompetitionEvent).toHaveBeenCalledTimes(2);
  });

  it("refuses to stop when the competition is not running", async () => {
    mocks.connection.execute.mockResolvedValueOnce([[
      { status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 },
    ]]);

    await expect(stopCompetition()).rejects.toThrow("competition_not_running");
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
    expect(mocks.connection.commit).not.toHaveBeenCalled();
    expect(mocks.insertCompetitionEvent).not.toHaveBeenCalled();
  });

  it("rejects answer writes before start or after stop", async () => {
    mocks.connection.execute.mockResolvedValueOnce([[
      { status: "ended", duration_minutes: 60, started_at: "2026-08-25 16:00:00.000", ends_at: "2026-08-25 16:20:00.000", stopped_at: "2026-08-25 16:20:00.000", active: 0 },
    ]]);

    await expect(saveAnswer({
      questionId: 1,
      contestantId: 7,
      contentHtml: "<p>不能保存</p>",
      submit: false,
    })).rejects.toThrow("competition_not_running");
    expect(mocks.connection.execute).toHaveBeenCalledOnce();
    expect(mocks.connection.rollback).toHaveBeenCalledOnce();
  });
});
