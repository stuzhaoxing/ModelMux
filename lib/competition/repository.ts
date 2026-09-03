import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { competitionPool, ensureCompetitionSchema, rows, type SqlValue } from "./db";
import { competitionControlFromStored } from "./control";
import { hashPassword } from "./auth";
import { generateContestantApiKey } from "./api-access";
import { insertCompetitionEvent } from "./events";
import { deleteStoredMediaFiles } from "./media";
import { withCompetitionTransaction } from "./transaction";
import type {
  AnswerStatus,
  CompetitionControl,
  CompetitionQuestion,
  CompetitionRole,
  CompetitionScreenNotice,
  CompetitionUser,
  ContestantAnswer,
  JudgeAnswerRow,
  JudgeQuestion,
  QuestionStatus,
} from "./types";

interface UserRow extends RowDataPacket {
  id: number;
  role: CompetitionRole;
  username: string;
  display_name: string;
  event_password: string | null;
  api_key: string | null;
  active: number;
  created_at: string;
  last_login_at: string | null;
}

interface QuestionRow extends RowDataPacket {
  id: number;
  title: string;
  content_html: string;
  status: QuestionStatus;
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  closed_at: string | null;
  author_name: string;
}

interface JudgeQuestionRow extends QuestionRow {
  contestant_total: number;
  submitted_count: number;
  draft_count: number;
}

interface LockedQuestionRow extends RowDataPacket {
  id: number;
  title: string;
  status: QuestionStatus;
}

interface CompetitionControlRow extends RowDataPacket {
  status: "not_started" | "running" | "ended";
  duration_minutes: number | string;
  started_at: string | null;
  ends_at: string | null;
  stopped_at: string | null;
  active: number | string;
}

interface CompetitionScreenNoticeRow extends RowDataPacket {
  title: string;
  content_text: string;
  enabled: number | boolean;
  updated_at: string;
}

interface AnswerRow extends RowDataPacket {
  id: number;
  question_id: number;
  content_html: string;
  status: Exclude<AnswerStatus, "not_started">;
  first_saved_at: string;
  updated_at: string;
  submitted_at: string | null;
}

interface JudgeAnswerRecord extends RowDataPacket {
  answer_id: number | null;
  question_id: number;
  content_html: string | null;
  answer_status: Exclude<AnswerStatus, "not_started"> | null;
  first_saved_at: string | null;
  answer_updated_at: string | null;
  submitted_at: string | null;
  contestant_id: number;
  contestant_name: string;
  username: string;
}

export interface JudgeExportContestant {
  id: number;
  username: string;
  displayName: string;
}

export interface JudgeAnswerExportSnapshot {
  questions: CompetitionQuestion[];
  contestants: JudgeExportContestant[];
  answers: JudgeAnswerRow[];
}

interface JudgeExportContestantRow extends RowDataPacket {
  contestant_id: number;
  username: string;
  contestant_name: string;
}

interface UserDeletionRow extends RowDataPacket {
  id: number;
}

interface UserAttachmentRow extends RowDataPacket {
  storage_name: string;
}

type JudgeExportAnswerRecord = JudgeAnswerRecord;

const competitionControlSelect = `SELECT status, duration_minutes, started_at, ends_at, stopped_at,
  (status = 'running' AND started_at <= CURRENT_TIMESTAMP(3) AND ends_at > CURRENT_TIMESTAMP(3)) AS active
  FROM competition_control WHERE id = 1`;

function toCompetitionControl(row: CompetitionControlRow, now = Date.now()): CompetitionControl {
  const control = competitionControlFromStored({
    status: row.status,
    durationMinutes: row.duration_minutes,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    stoppedAt: row.stopped_at,
  }, now);
  return Boolean(Number(row.active)) ? { ...control, state: "running" } : control;
}

async function lockCompetitionControl(connection: PoolConnection): Promise<CompetitionControlRow> {
  const [controls] = await connection.execute<CompetitionControlRow[]>(
    `${competitionControlSelect} FOR UPDATE`,
  );
  if (!controls[0]) throw new Error("competition_control_missing");
  return controls[0];
}

export async function getCompetitionControl(now = Date.now()): Promise<CompetitionControl> {
  const result = await rows<CompetitionControlRow[]>(competitionControlSelect);
  if (!result[0]) throw new Error("competition_control_missing");
  return toCompetitionControl(result[0], now);
}

export async function getCompetitionScreenNotice(): Promise<CompetitionScreenNotice> {
  const result = await rows<CompetitionScreenNoticeRow[]>(
    `SELECT title, content_text, enabled, updated_at
     FROM competition_screen_notice WHERE id = 1`,
  );
  const notice = result[0];
  return notice ? {
    title: notice.title,
    content: notice.content_text,
    enabled: Boolean(notice.enabled),
    updatedAt: notice.updated_at,
  } : {
    title: "赛前提醒",
    content: "",
    enabled: false,
    updatedAt: null,
  };
}

export async function updateCompetitionScreenNotice(input: {
  title: string;
  content: string;
  enabled: boolean;
}): Promise<CompetitionScreenNotice> {
  await ensureCompetitionSchema();
  await competitionPool().execute(
    `INSERT INTO competition_screen_notice (id, title, content_text, enabled)
     VALUES (1, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), content_text = VALUES(content_text), enabled = VALUES(enabled)`,
    [input.title, input.content, input.enabled],
  );
  return getCompetitionScreenNotice();
}

function toUser(row: UserRow): CompetitionUser {
  return {
    id: Number(row.id),
    role: row.role,
    username: row.username,
    displayName: row.display_name,
    password: row.event_password,
    apiKey: row.api_key,
    active: Boolean(row.active),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function toQuestion(row: QuestionRow): CompetitionQuestion {
  return {
    id: Number(row.id),
    title: row.title,
    contentHtml: row.content_html,
    status: row.status,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at,
    closedAt: row.closed_at,
    authorName: row.author_name,
  };
}

function toAnswer(row: AnswerRow): ContestantAnswer {
  return {
    id: Number(row.id),
    questionId: Number(row.question_id),
    contentHtml: row.content_html,
    status: row.status,
    firstSavedAt: row.first_saved_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
  };
}

export async function listUsers(): Promise<CompetitionUser[]> {
  const result = await rows<UserRow[]>(
    `SELECT id, role, username, display_name, event_password, api_key,
       active, created_at, last_login_at
     FROM competition_users WHERE deleted_at IS NULL ORDER BY role, display_name, username`,
  );
  return result.map(toUser);
}

async function hardDeleteContestantRecord(
  selector: { id: number } | { deletedUsername: string },
): Promise<boolean> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  const storageNames = await withCompetitionTransaction(connection, async (transaction) => {
    const [users] = "id" in selector
      ? await transaction.execute<UserDeletionRow[]>(
          `SELECT id FROM competition_users
           WHERE id = ? AND role = 'contestant'
           LIMIT 1 FOR UPDATE`,
          [selector.id],
        )
      : await transaction.execute<UserDeletionRow[]>(
          `SELECT id FROM competition_users
           WHERE role = 'contestant' AND username = ? AND deleted_at IS NOT NULL
           LIMIT 1 FOR UPDATE`,
          [selector.deletedUsername],
        );
    const user = users[0];
    if (!user) return null;

    const userId = Number(user.id);
    const [attachments] = await transaction.execute<UserAttachmentRow[]>(
      `SELECT storage_name FROM competition_attachments
       WHERE uploader_id = ? AND uploader_role = 'contestant'
       FOR UPDATE`,
      [userId],
    );
    await transaction.execute(
      "DELETE FROM competition_answers WHERE contestant_id = ?",
      [userId],
    );
    await transaction.execute(
      "DELETE FROM competition_attachments WHERE uploader_id = ? AND uploader_role = 'contestant'",
      [userId],
    );
    const [result] = await transaction.execute<ResultSetHeader>(
      "DELETE FROM competition_users WHERE id = ? AND role = 'contestant'",
      [userId],
    );
    if (result.affectedRows !== 1) throw new Error("competition_user_delete_failed");
    return attachments.map((attachment) => attachment.storage_name);
  });

  if (!storageNames) return false;
  await deleteStoredMediaFiles(storageNames);
  return true;
}

async function purgeDeletedContestantUsername(username: string): Promise<void> {
  await hardDeleteContestantRecord({ deletedUsername: username });
}

export async function createUser(input: {
  role: CompetitionRole;
  username: string;
  displayName: string;
  password: string;
}): Promise<number> {
  await ensureCompetitionSchema();
  const username = input.username.trim().toLowerCase();
  if (input.role === "contestant") {
    await purgeDeletedContestantUsername(username);
  }
  const passwordHash = await hashPassword(input.password);
  const apiKey = input.role === "contestant" ? generateContestantApiKey() : null;
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `INSERT INTO competition_users
       (role, username, display_name, password_hash, event_password, api_key)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      input.role,
      username,
      input.displayName.trim(),
      passwordHash,
      input.password,
      apiKey,
    ],
  );
  return Number(result.insertId);
}

const generatedCredentialAlphabet = "abcdefghijkmnpqrstuvwxyz23456789";

function randomCredential(length: number): string {
  const bytes = randomBytes(length);
  return Array.from(bytes, (value) => generatedCredentialAlphabet[value % generatedCredentialAlphabet.length]).join("");
}

export async function createGeneratedUser(role: CompetitionRole): Promise<{
  id: number;
  role: CompetitionRole;
  username: string;
  displayName: string;
  password: string;
  apiKey: string | null;
}> {
  await ensureCompetitionSchema();
  const roleName = role === "judge" ? "评委" : "选手";
  const usernamePrefix = role === "judge" ? "judge" : "contestant";

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = randomCredential(6);
    const username = `${usernamePrefix}-${suffix}`;
    const displayName = `${roleName} ${suffix.toUpperCase()}`;
    const password = `${randomCredential(12)}!`;
    try {
      const passwordHash = await hashPassword(password);
      const apiKey = role === "contestant" ? generateContestantApiKey() : null;
      const [result] = await competitionPool().execute<ResultSetHeader>(
        `INSERT INTO competition_users
           (role, username, display_name, password_hash, event_password, api_key)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [role, username, displayName, passwordHash, password, apiKey],
      );
      return {
        id: Number(result.insertId),
        role,
        username,
        displayName,
        password,
        apiKey,
      };
    } catch (error) {
      const duplicate = typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
      if (!duplicate || attempt === 7) throw error;
    }
  }

  throw new Error("generated_account_failed");
}

interface ContestantApiRow extends RowDataPacket {
  id: number;
  username: string;
  display_name: string;
  api_key: string;
}

export interface ContestantApiIdentity {
  id: number;
  username: string;
  displayName: string;
  apiKey: string;
}

function toContestantApiIdentity(row: ContestantApiRow): ContestantApiIdentity {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    apiKey: row.api_key,
  };
}

export async function contestantApiAccess(
  contestantId: number,
): Promise<ContestantApiIdentity | null> {
  const result = await rows<ContestantApiRow[]>(
    `SELECT id, username, display_name, api_key
     FROM competition_users
     WHERE id = ? AND role = 'contestant' AND active = TRUE
       AND deleted_at IS NULL AND api_key IS NOT NULL
     LIMIT 1`,
    [contestantId],
  );
  return result[0] ? toContestantApiIdentity(result[0]) : null;
}

export async function authenticateContestantApiKey(
  apiKey: string,
): Promise<ContestantApiIdentity | null> {
  if (!apiKey.startsWith("sk-competition-")) return null;
  const result = await rows<ContestantApiRow[]>(
    `SELECT id, username, display_name, api_key
     FROM competition_users
     WHERE api_key = ? AND role = 'contestant' AND active = TRUE
       AND deleted_at IS NULL
     LIMIT 1`,
    [apiKey],
  );
  return result[0] ? toContestantApiIdentity(result[0]) : null;
}

export interface CompetitionTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export async function recordCompetitionTokenUsage(
  usage: CompetitionTokenUsage,
): Promise<void> {
  await ensureCompetitionSchema();
  await competitionPool().execute(
    `INSERT INTO competition_token_minutes
       (minute_at, input_tokens, output_tokens, total_tokens)
     VALUES (DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:%i:00'), ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       input_tokens = input_tokens + ?,
       output_tokens = output_tokens + ?,
       total_tokens = total_tokens + ?`,
    [
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
      usage.inputTokens,
      usage.outputTokens,
      usage.totalTokens,
    ],
  );
}

export async function updateUser(input: {
  id: number;
  displayName?: string;
  active?: boolean;
}): Promise<boolean> {
  await ensureCompetitionSchema();
  const assignments: string[] = [];
  const values: SqlValue[] = [];
  if (input.displayName !== undefined) {
    assignments.push("display_name = ?");
    values.push(input.displayName.trim());
  }
  if (input.active !== undefined) {
    assignments.push("active = ?");
    values.push(input.active);
  }
  if (assignments.length === 0) return false;
  values.push(input.id);
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `UPDATE competition_users SET ${assignments.join(", ")} WHERE id = ? AND role = 'contestant'`,
    values,
  );
  if (input.active === false && result.affectedRows > 0) {
    await competitionPool().execute(
      "UPDATE competition_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL",
      [input.id],
    );
  }
  return result.affectedRows > 0;
}

export async function deleteUser(id: number): Promise<boolean> {
  return hardDeleteContestantRecord({ id });
}

const questionSelect = `SELECT q.id, q.title, q.content_html, q.status, q.version,
  q.created_at, q.updated_at, q.published_at, q.closed_at,
  COALESCE(u.display_name, '管理员') AS author_name
  FROM competition_questions q
  LEFT JOIN competition_users u ON u.id = q.created_by`;

const activeContestantIds = `SELECT cu.id FROM competition_users cu
  WHERE cu.role = 'contestant' AND cu.active = TRUE AND cu.deleted_at IS NULL`;

const answerCountFor = (status: "submitted" | "draft") =>
  `(SELECT COUNT(*) FROM competition_answers a
    WHERE a.question_id = q.id AND a.status = '${status}'
      AND a.contestant_id IN (${activeContestantIds}))`;

const judgeQuestionSelect = `SELECT q.id, q.title, q.content_html, q.status, q.version,
  q.created_at, q.updated_at, q.published_at, q.closed_at,
  COALESCE(u.display_name, '管理员') AS author_name,
  (SELECT COUNT(*) FROM (${activeContestantIds}) roster) AS contestant_total,
  ${answerCountFor("submitted")} AS submitted_count,
  ${answerCountFor("draft")} AS draft_count
  FROM competition_questions q
  LEFT JOIN competition_users u ON u.id = q.created_by`;

export async function listJudgeQuestions(): Promise<JudgeQuestion[]> {
  const result = await rows<JudgeQuestionRow[]>(
    `${judgeQuestionSelect} ORDER BY q.created_at DESC`,
  );
  return result.map((row) => {
    const total = Number(row.contestant_total);
    const submitted = Number(row.submitted_count);
    const drafting = Number(row.draft_count);
    return {
      ...toQuestion(row),
      progress: {
        total,
        submitted,
        drafting,
        notStarted: Math.max(0, total - submitted - drafting),
      },
    };
  });
}

export async function listContestantQuestions(): Promise<CompetitionQuestion[]> {
  const result = await rows<QuestionRow[]>(
    `${questionSelect} WHERE q.status IN ('published', 'closed')
     ORDER BY q.published_at DESC, q.id DESC`,
  );
  return result.map(toQuestion);
}

export async function getQuestion(id: number): Promise<CompetitionQuestion | null> {
  const result = await rows<QuestionRow[]>(`${questionSelect} WHERE q.id = ? LIMIT 1`, [id]);
  return result[0] ? toQuestion(result[0]) : null;
}

export async function createQuestion(input: {
  authorId: number | null;
  title: string;
  contentHtml: string;
}): Promise<number> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const control = await lockCompetitionControl(transaction);
    if (Boolean(Number(control.active))) throw new Error("competition_running");
    const [result] = await transaction.execute<ResultSetHeader>(
      `INSERT INTO competition_questions
         (title, content_html, status, created_by, published_at)
       VALUES (?, ?, 'draft', ?, NULL)`,
      [input.title, input.contentHtml, input.authorId],
    );
    const id = Number(result.insertId);
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: id });
    return id;
  });
}

export async function updateQuestion(input: {
  id: number;
  title: string;
  contentHtml: string;
  expectedVersion: number;
}): Promise<boolean> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const control = await lockCompetitionControl(transaction);
    if (Boolean(Number(control.active))) throw new Error("competition_running");
    const [result] = await transaction.execute<ResultSetHeader>(
      `UPDATE competition_questions
       SET title = ?, content_html = ?, version = version + 1
       WHERE id = ? AND version = ?`,
      [input.title, input.contentHtml, input.id, input.expectedVersion],
    );
    if (result.affectedRows === 0) return false;
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: input.id });
    return true;
  });
}

export async function deleteQuestionWhileStopped(id: number): Promise<{
  title: string;
  answerCount: number;
}> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const control = await lockCompetitionControl(transaction);
    if (Boolean(Number(control.active))) throw new Error("competition_running");

    const [questions] = await transaction.execute<LockedQuestionRow[]>(
      "SELECT id, title, status FROM competition_questions WHERE id = ? FOR UPDATE",
      [id],
    );
    const question = questions[0];
    if (!question) throw new Error("question_not_found");

    const [answerCounts] = await transaction.execute<(RowDataPacket & { answer_count: number | string })[]>(
      "SELECT COUNT(*) AS answer_count FROM competition_answers WHERE question_id = ?",
      [id],
    );
    const [result] = await transaction.execute<ResultSetHeader>(
      "DELETE FROM competition_questions WHERE id = ?",
      [id],
    );
    if (result.affectedRows !== 1) throw new Error("question_set_conflict");
    return {
      title: question.title,
      answerCount: Number(answerCounts[0]?.answer_count ?? 0),
    };
  });
}

export async function startCompetition(durationMinutes: number): Promise<{
  competition: CompetitionControl;
  questionCount: number;
}> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    await lockCompetitionControl(transaction);
    const [questionSet] = await transaction.execute<LockedQuestionRow[]>(
      "SELECT id, title, status FROM competition_questions ORDER BY id FOR UPDATE",
    );
    if (questionSet.length === 0) throw new Error("question_set_empty");
    const [result] = await transaction.execute<ResultSetHeader>(
      `UPDATE competition_questions
       SET status = 'published', published_at = COALESCE(published_at, CURRENT_TIMESTAMP(3)),
           closed_at = NULL, version = version + 1
       WHERE status IN ('draft', 'published', 'closed')`,
    );
    if (result.affectedRows !== questionSet.length) throw new Error("question_set_conflict");
    await transaction.execute(
      `UPDATE competition_control
       SET status = 'running', duration_minutes = ?,
           started_at = CURRENT_TIMESTAMP(3),
           ends_at = TIMESTAMPADD(MINUTE, ?, CURRENT_TIMESTAMP(3)),
           stopped_at = NULL
       WHERE id = 1`,
      [durationMinutes, durationMinutes],
    );
    for (const question of questionSet) {
      await insertCompetitionEvent(transaction, { type: "question-updated", questionId: Number(question.id) });
    }
    const [controls] = await transaction.execute<CompetitionControlRow[]>(competitionControlSelect);
    if (!controls[0]) throw new Error("competition_control_missing");
    return {
      competition: toCompetitionControl(controls[0]),
      questionCount: questionSet.length,
    };
  });
}

export async function stopCompetition(): Promise<{
  competition: CompetitionControl;
  questionCount: number;
}> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const control = await lockCompetitionControl(transaction);
    if (!Boolean(Number(control.active))) throw new Error("competition_not_running");
    const [questionSet] = await transaction.execute<LockedQuestionRow[]>(
      "SELECT id, title, status FROM competition_questions ORDER BY id FOR UPDATE",
    );
    await transaction.execute(
      `UPDATE competition_control
       SET status = 'ended', ends_at = CURRENT_TIMESTAMP(3),
           stopped_at = CURRENT_TIMESTAMP(3)
       WHERE id = 1`,
    );
    for (const question of questionSet) {
      await insertCompetitionEvent(transaction, { type: "question-updated", questionId: Number(question.id) });
    }
    const [controls] = await transaction.execute<CompetitionControlRow[]>(competitionControlSelect);
    if (!controls[0]) throw new Error("competition_control_missing");
    return {
      competition: toCompetitionControl(controls[0]),
      questionCount: questionSet.length,
    };
  });
}

export async function listAnswersForContestant(contestantId: number): Promise<ContestantAnswer[]> {
  const result = await rows<AnswerRow[]>(
    `SELECT id, question_id, content_html, status, first_saved_at, updated_at, submitted_at
     FROM competition_answers WHERE contestant_id = ? ORDER BY question_id DESC`,
    [contestantId],
  );
  return result.map(toAnswer);
}

export async function listAnswersForJudge(questionId: number): Promise<JudgeAnswerRow[]> {
  const result = await rows<JudgeAnswerRecord[]>(
    `SELECT a.id AS answer_id, ? AS question_id, a.content_html,
       a.status AS answer_status, a.first_saved_at, a.updated_at AS answer_updated_at,
       a.submitted_at, u.id AS contestant_id,
       u.display_name AS contestant_name, u.username
     FROM competition_users u
     LEFT JOIN competition_answers a
       ON a.contestant_id = u.id AND a.question_id = ?
     WHERE u.role = 'contestant' AND u.active = TRUE AND u.deleted_at IS NULL
     ORDER BY u.display_name, u.username`,
    [questionId, questionId],
  );
  return result.map((row) => ({
    id: row.answer_id === null ? null : Number(row.answer_id),
    questionId: Number(row.question_id),
    contentHtml: row.content_html ?? "",
    status: row.answer_status ?? "not_started",
    firstSavedAt: row.first_saved_at,
    updatedAt: row.answer_updated_at,
    submittedAt: row.submitted_at,
    contestantId: Number(row.contestant_id),
    contestantName: row.contestant_name,
    username: row.username,
  }));
}

export async function getJudgeAnswerExportSnapshot(): Promise<JudgeAnswerExportSnapshot> {
  const [questionRows, contestantRows, answerRows] = await Promise.all([
    rows<QuestionRow[]>(`${questionSelect} WHERE q.status IN ('published', 'closed') ORDER BY q.published_at DESC, q.id DESC`),
    rows<JudgeExportContestantRow[]>(
      `SELECT id AS contestant_id, username, display_name AS contestant_name
       FROM competition_users
       WHERE role = 'contestant' AND active = TRUE AND deleted_at IS NULL
       ORDER BY display_name, username`,
    ),
    rows<JudgeExportAnswerRecord[]>(
      `SELECT a.id AS answer_id, a.question_id, a.content_html,
         a.status AS answer_status, a.first_saved_at, a.updated_at AS answer_updated_at,
         a.submitted_at, u.id AS contestant_id,
         u.display_name AS contestant_name, u.username
       FROM competition_answers a
       INNER JOIN competition_questions q ON q.id = a.question_id
       INNER JOIN competition_users u ON u.id = a.contestant_id
       WHERE q.status IN ('published', 'closed')
         AND u.role = 'contestant' AND u.active = TRUE AND u.deleted_at IS NULL
       ORDER BY q.published_at DESC, q.id DESC, u.display_name, u.username`,
    ),
  ]);

  return {
    questions: questionRows.map(toQuestion),
    contestants: contestantRows.map((row) => ({
      id: Number(row.contestant_id),
      username: row.username,
      displayName: row.contestant_name,
    })),
    answers: answerRows.map((row) => ({
      id: row.answer_id === null ? null : Number(row.answer_id),
      questionId: Number(row.question_id),
      contentHtml: row.content_html ?? "",
      status: row.answer_status ?? "not_started",
      firstSavedAt: row.first_saved_at,
      updatedAt: row.answer_updated_at,
      submittedAt: row.submitted_at,
      contestantId: Number(row.contestant_id),
      contestantName: row.contestant_name,
      username: row.username,
    })),
  };
}

export interface SavedAnswer {
  answer: ContestantAnswer;
  questionTitle: string;
  firstSave: boolean;
}

export async function saveAnswer(input: {
  questionId: number;
  contestantId: number;
  contentHtml: string;
  submit: boolean;
}): Promise<SavedAnswer> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const control = await lockCompetitionControl(transaction);
    if (!Boolean(Number(control.active))) throw new Error("competition_not_running");
    const [questions] = await transaction.execute<(RowDataPacket & { status: QuestionStatus; title: string })[]>(
      "SELECT status, title FROM competition_questions WHERE id = ? FOR UPDATE",
      [input.questionId],
    );
    if (!questions[0]) throw new Error("question_not_found");
    if (questions[0].status !== "published") throw new Error("question_not_open");

    const [answers] = await transaction.execute<AnswerRow[]>(
      `SELECT id, question_id, content_html, status, first_saved_at, updated_at, submitted_at
       FROM competition_answers WHERE question_id = ? AND contestant_id = ? FOR UPDATE`,
      [input.questionId, input.contestantId],
    );
    if (answers[0]?.status === "submitted") throw new Error("answer_locked");

    await transaction.execute(
      `INSERT INTO competition_answers
         (question_id, contestant_id, content_html, status, submitted_at)
       VALUES (?, ?, ?, ?, ${input.submit ? "CURRENT_TIMESTAMP(3)" : "NULL"})
       ON DUPLICATE KEY UPDATE
         content_html = VALUES(content_html),
         status = VALUES(status),
         submitted_at = ${input.submit ? "CURRENT_TIMESTAMP(3)" : "submitted_at"}`,
      [
        input.questionId,
        input.contestantId,
        input.contentHtml,
        input.submit ? "submitted" : "draft",
      ],
    );
    const [saved] = await transaction.execute<AnswerRow[]>(
      `SELECT id, question_id, content_html, status, first_saved_at, updated_at, submitted_at
       FROM competition_answers WHERE question_id = ? AND contestant_id = ?`,
      [input.questionId, input.contestantId],
    );
    await insertCompetitionEvent(transaction, { type: "answer-updated", questionId: input.questionId });
    return {
      answer: toAnswer(saved[0]),
      questionTitle: questions[0].title,
      firstSave: answers[0] === undefined,
    };
  });
}
