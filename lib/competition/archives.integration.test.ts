import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { competitionPool, ensureCompetitionSchema } from "./db";
import { getCompetitionArchive, listCompetitionArchives, resetCompetitionAnswers, restoreCompetitionArchive } from "./archives";
import { getCompetitionControl, recordCompetitionTokenUsage, saveAnswer, startCompetition, stopCompetition } from "./repository";
import { competitionModeFromControl } from "./control";
import { recordActivity } from "./activity";

// Explicit opt-in only. Even then, all mutations occur in a freshly created,
// randomly named database; the configured competition database is never selected.
const sourceUrl = process.env.MODELMUX_ARCHIVE_TEST_URL;
describe.skipIf(!sourceUrl)("archive/reset with real MySQL transactions", () => {
  let admin: Connection;
  let created = false;
  const database = `modelmux_reset_test_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
  const previousUrl = process.env.MODELMUX_DATABASE_URL;
  let archiveId: string;
  let questionSnapshot: RowDataPacket[];
  let accountSnapshot: RowDataPacket[];
  beforeAll(async () => {
    const url = new URL(sourceUrl!);
    url.pathname = "/";
    admin = await mysql.createConnection(url.toString());
    await admin.execute(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    created = true;
    url.pathname = `/${database}`;
    process.env.MODELMUX_DATABASE_URL = url.toString();
    await ensureCompetitionSchema();
    const pool = competitionPool();
    await pool.execute("INSERT INTO competition_users (id, role, username, display_name, password_hash, event_password, api_key) VALUES (1, 'contestant', 'test-user', '测试选手', 'hash', 'kept-password', 'sk-test-kept')");
    await pool.execute("INSERT INTO competition_questions (id, phase, title, content_html, status) VALUES (1, 'test', '测试题', '<p>题目一</p>', 'draft'), (2, 'competition', '正式赛题', '<p>题目二</p>', 'published')");
    await pool.execute("INSERT INTO competition_answers (question_id, contestant_id, content_html, status, submitted_at) VALUES (1, 1, '<p>草稿</p>', 'draft', NULL), (2, 1, '<p>已提交<img src=\"/api/competition/media/1\"></p>', 'submitted', CURRENT_TIMESTAMP(3))");
    await pool.execute("INSERT INTO competition_attachments (id, uploader_id, uploader_role, purpose, storage_name, original_name, mime_type, byte_size) VALUES (1, 1, 'contestant', 'answer', 'keep.png', '答案.png', 'image/png', 20)");
    await pool.execute("INSERT INTO competition_activity (category, action, actor_role, actor_id, actor_username, actor_name) VALUES ('answer', 'answer-submitted', 'contestant', 1, 'test-user', '测试选手'), ('auth', 'login', 'contestant', 1, 'test-user', '测试选手')");
    await recordCompetitionTokenUsage({ inputTokens: 8, outputTokens: 2, totalTokens: 10 }, 0);
    [questionSnapshot] = await pool.execute<RowDataPacket[]>("SELECT * FROM competition_questions ORDER BY id");
    [accountSnapshot] = await pool.execute<RowDataPacket[]>("SELECT * FROM competition_users ORDER BY id");
  });
  afterAll(async () => {
    await globalThis.__modelmuxCompetitionPool?.end();
    globalThis.__modelmuxCompetitionPool = undefined;
    globalThis.__modelmuxCompetitionSchema = undefined;
    globalThis.__modelmuxCompetitionSchemaVersion = undefined;
    process.env.MODELMUX_DATABASE_URL = previousUrl;
    if (admin) { if (created) await admin.execute(`DROP DATABASE ${database}`); await admin.end(); }
  });
  async function count(table: string) {
    const [result] = await competitionPool().execute<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM ${table}`);
    return Number(result[0].total);
  }
  it("atomically archives both phases, clears answers/statistics and preserves accounts, questions and media", async () => {
    const result = await resetCompetitionAnswers(0, "管理员");
    archiveId = result.archiveId;
    expect(result.generation).toBe(1);
    const archived = await getCompetitionArchive(archiveId);
    expect(archived.archive).toMatchObject({ answerCount: 2, submittedCount: 1, contestantCount: 1 });
    expect(archived.snapshot.answer).toHaveLength(2);
    expect(archived.snapshot.token[0].total_tokens).toBe(10);
    expect(archived.snapshot.answer_activity).toHaveLength(1);
    expect(JSON.stringify(archived)).not.toContain("kept-password");
    expect(await count("competition_answers")).toBe(0);
    expect(await count("competition_token_minutes")).toBe(0);
    expect(await count("competition_activity")).toBe(1);
    expect(await count("competition_attachments")).toBe(1);
    expect((await competitionPool().execute("SELECT * FROM competition_questions ORDER BY id"))[0]).toEqual(questionSnapshot);
    expect((await competitionPool().execute("SELECT * FROM competition_users ORDER BY id"))[0]).toEqual(accountSnapshot);
    expect(await getCompetitionControl()).toMatchObject({ generation: 1, state: "not_started", phase: "test", startedAt: null });
  });
  it("rejects stale and legacy browser saves and late token/log writes after a reset", async () => {
    for (const generation of [undefined, 0]) {
      await expect(saveAnswer({ questionId: 1, contestantId: 1, contentHtml: "旧页面", submit: false, generation })).rejects.toThrow("competition_generation_changed");
    }
    await recordCompetitionTokenUsage({ inputTokens: 99, outputTokens: 1, totalTokens: 100 }, 0);
    await recordActivity({ generation: 0, category: "answer", action: "answer-saved", actorRole: "contestant", actorId: 1, actorUsername: "test-user", actorName: "测试选手", questionId: 1, questionTitle: "测试题", detail: null, outcome: "ok" });
    expect(await count("competition_answers")).toBe(0);
    expect(await count("competition_token_minutes")).toBe(0);
    expect(await count("competition_activity")).toBe(1);
    await saveAnswer({ questionId: 1, contestantId: 1, contentHtml: "<p>新一轮</p>", submit: false, generation: 1 });
  });
  it("restores original answer content and timestamps, backing up new work first", async () => {
    const result = await restoreCompetitionArchive(archiveId, 1, "管理员");
    const backup = await getCompetitionArchive(result.archiveId);
    expect(backup.archive.reason).toBe("before_restore");
    expect(backup.snapshot.answer[0].content_html).toBe("<p>新一轮</p>");
    const original = await getCompetitionArchive(archiveId);
    expect((await competitionPool().execute("SELECT * FROM competition_answers ORDER BY id"))[0]).toEqual(original.snapshot.answer);
    expect(await count("competition_token_minutes")).toBe(1);
    expect(await getCompetitionControl()).toMatchObject({ generation: 2, state: "not_started" });
  });
  it("rolls back both snapshot and deletion if clearing fails", async () => {
    await competitionPool().query("CREATE TRIGGER reject_reset BEFORE DELETE ON competition_answers FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced_clear_failure'");
    await expect(resetCompetitionAnswers(2, "管理员")).rejects.toThrow("forced_clear_failure");
    await competitionPool().query("DROP TRIGGER reject_reset");
    expect(await count("competition_answers")).toBe(2);
    expect(await count("competition_archives")).toBe(2);
    expect(await getCompetitionControl()).toMatchObject({ generation: 2 });
  });
  it("never clears current answers if writing the archive fails", async () => {
    await competitionPool().query("CREATE TRIGGER reject_archive BEFORE INSERT ON competition_archive_entries FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced_archive_failure'");
    await expect(resetCompetitionAnswers(2, "管理员")).rejects.toThrow("forced_archive_failure");
    await competitionPool().query("DROP TRIGGER reject_archive");
    expect(await count("competition_answers")).toBe(2);
    expect(await count("competition_archives")).toBe(2);
  });
  it("rejects incompatible restores without losing current data or retaining a partial backup", async () => {
    await competitionPool().execute("UPDATE competition_questions SET title = '修改后题目' WHERE id = 1");
    await expect(restoreCompetitionArchive(archiveId, 2, "管理员")).rejects.toThrow("archive_incompatible");
    expect(await count("competition_answers")).toBe(2);
    expect(await count("competition_archives")).toBe(2);
    await competitionPool().execute("UPDATE competition_questions SET title = '测试题' WHERE id = 1");
  });
  it("serializes duplicate resets and concurrent answer saves", async () => {
    const results = await Promise.allSettled([
      resetCompetitionAnswers(2, "管理员"), resetCompetitionAnswers(2, "管理员"),
      saveAnswer({ questionId: 1, contestantId: 1, contentHtml: "<p>并发保存</p>", submit: false, generation: 2 }),
    ]);
    expect(results.slice(0, 2).filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(await count("competition_answers")).toBe(0);
    expect(await count("competition_archives")).toBe(3);
    const archives = await listCompetitionArchives();
    expect((await getCompetitionArchive(archives[0].id)).snapshot.answer).toHaveLength(2);
  });
  it("allows a clean formal start and rejects reset/restore while running", async () => {
    await startCompetition(90);
    await expect(resetCompetitionAnswers(3, "管理员")).rejects.toThrow("archive_running");
    await expect(restoreCompetitionArchive(archiveId, 3, "管理员")).rejects.toThrow("archive_running");
    await saveAnswer({ questionId: 2, contestantId: 1, contentHtml: "<p>正式答卷</p>", submit: true, generation: 3 });
    expect(await count("competition_answers")).toBe(1);
    expect(await count("competition_archives")).toBe(3);
  });
  it("restores a formal competition archive without switching the pre-competition mode or duration", async () => {
    await stopCompetition();
    const formal = await resetCompetitionAnswers(3, "管理员");
    await competitionPool().execute("UPDATE competition_control SET duration_minutes = 120 WHERE id = 1");
    const before = await getCompetitionControl();
    expect(competitionModeFromControl(before)).toBe("test");
    const archive = await getCompetitionArchive(formal.archiveId);
    expect(archive.control.started_at).not.toBeNull();
    await restoreCompetitionArchive(formal.archiveId, 4, "管理员");
    const after = await getCompetitionControl();
    expect(after).toEqual({ ...before, generation: 5 });
    expect(competitionModeFromControl(after)).toBe("test");
    expect(await count("competition_answers")).toBe(1);
    expect((await getCompetitionArchive(formal.archiveId)).control).toEqual(archive.control);
  });
  it("preserves an ended competition when restoring answers from a pre-competition archive", async () => {
    await startCompetition(45);
    await stopCompetition();
    const before = await getCompetitionControl();
    expect(competitionModeFromControl(before)).toBe("competition");
    expect(before.state).toBe("ended");
    await restoreCompetitionArchive(archiveId, 5, "管理员");
    const after = await getCompetitionControl();
    expect(after).toEqual({ ...before, generation: 6 });
    expect(competitionModeFromControl(after)).toBe("competition");
    expect(await count("competition_answers")).toBe(2);
  });

  it("requires archive/reset after both manual and automatic end before the next competition", async () => {
    const ended = await getCompetitionControl();
    expect(ended.state).toBe("ended");
    await expect(startCompetition(90)).rejects.toThrow("competition_reset_required");
    expect(await getCompetitionControl()).toEqual(ended);
    expect(await count("competition_answers")).toBe(2);

    const manualArchive = await resetCompetitionAnswers(6, "管理员");
    expect((await getCompetitionArchive(manualArchive.archiveId)).snapshot.answer).toHaveLength(2);
    expect(await getCompetitionControl()).toMatchObject({ phase: "test", state: "not_started", generation: 7 });
    expect(await count("competition_answers")).toBe(0);
    expect((await startCompetition(90)).competition.state).toBe("running");
    await saveAnswer({ questionId: 2, contestantId: 1, contentHtml: "<p>到时结束的答卷</p>", submit: true, generation: 7 });
    // Simulate elapsed time only inside the disposable database.
    await competitionPool().execute("UPDATE competition_control SET started_at = TIMESTAMPADD(MINUTE, -90, CURRENT_TIMESTAMP(3)), ends_at = TIMESTAMPADD(SECOND, -1, CURRENT_TIMESTAMP(3)) WHERE id = 1");
    expect(await getCompetitionControl()).toMatchObject({ state: "ended", stoppedAt: null });
    await expect(startCompetition(90)).rejects.toThrow("competition_reset_required");
    const expiredArchive = await resetCompetitionAnswers(7, "管理员");
    expect((await getCompetitionArchive(expiredArchive.archiveId)).snapshot.answer[0].content_html).toBe("<p>到时结束的答卷</p>");
    expect(await getCompetitionControl()).toMatchObject({ phase: "test", state: "not_started", generation: 8 });
    expect(await count("competition_answers")).toBe(0);
    expect((await startCompetition(60)).competition).toMatchObject({ state: "running", durationMinutes: 60 });
    expect((await competitionPool().execute("SELECT * FROM competition_users ORDER BY id"))[0]).toEqual(accountSnapshot);
    expect(await count("competition_questions")).toBe(2);
  });

});
