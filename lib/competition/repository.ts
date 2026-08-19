import { randomBytes } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

import { competitionPool, ensureCompetitionSchema, rows, type SqlValue } from "./db";
import { hashPassword } from "./auth";
import {
  contestantDefaultRequestQuota,
  generateContestantApiKey,
} from "./api-access";
import { insertCompetitionEvent } from "./events";
import { withCompetitionTransaction } from "./transaction";
import type {
  AnswerStatus,
  CompetitionQuestion,
  CompetitionRole,
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
  api_request_quota: number;
  api_requests_used: number;
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

function toUser(row: UserRow): CompetitionUser {
  return {
    id: Number(row.id),
    role: row.role,
    username: row.username,
    displayName: row.display_name,
    password: row.event_password,
    apiKey: row.api_key,
    requestQuota: Number(row.api_request_quota),
    requestsUsed: Number(row.api_requests_used),
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
       api_request_quota, api_requests_used, active, created_at, last_login_at
     FROM competition_users WHERE deleted_at IS NULL ORDER BY role, display_name, username`,
  );
  return result.map(toUser);
}

export async function createUser(input: {
  role: CompetitionRole;
  username: string;
  displayName: string;
  password: string;
}): Promise<number> {
  await ensureCompetitionSchema();
  const passwordHash = await hashPassword(input.password);
  const apiKey = input.role === "contestant" ? generateContestantApiKey() : null;
  const requestQuota = input.role === "contestant" ? contestantDefaultRequestQuota() : 0;
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `INSERT INTO competition_users
       (role, username, display_name, password_hash, event_password, api_key, api_request_quota)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      input.role,
      input.username.trim().toLowerCase(),
      input.displayName.trim(),
      passwordHash,
      input.password,
      apiKey,
      requestQuota,
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
  requestQuota: number;
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
      const requestQuota = role === "contestant" ? contestantDefaultRequestQuota() : 0;
      const [result] = await competitionPool().execute<ResultSetHeader>(
        `INSERT INTO competition_users
           (role, username, display_name, password_hash, event_password, api_key, api_request_quota)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [role, username, displayName, passwordHash, password, apiKey, requestQuota],
      );
      return {
        id: Number(result.insertId),
        role,
        username,
        displayName,
        password,
        apiKey,
        requestQuota,
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
  api_request_quota: number;
  api_requests_used: number;
}

export interface ContestantApiIdentity {
  id: number;
  username: string;
  displayName: string;
  apiKey: string;
  requestQuota: number;
  requestsUsed: number;
}

function toContestantApiIdentity(row: ContestantApiRow): ContestantApiIdentity {
  return {
    id: Number(row.id),
    username: row.username,
    displayName: row.display_name,
    apiKey: row.api_key,
    requestQuota: Number(row.api_request_quota),
    requestsUsed: Number(row.api_requests_used),
  };
}

export async function contestantApiAccess(
  contestantId: number,
): Promise<ContestantApiIdentity | null> {
  const result = await rows<ContestantApiRow[]>(
    `SELECT id, username, display_name, api_key, api_request_quota, api_requests_used
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
    `SELECT id, username, display_name, api_key, api_request_quota, api_requests_used
     FROM competition_users
     WHERE api_key = ? AND role = 'contestant' AND active = TRUE
       AND deleted_at IS NULL
     LIMIT 1`,
    [apiKey],
  );
  return result[0] ? toContestantApiIdentity(result[0]) : null;
}

export interface ContestantQuotaReservation {
  allowed: boolean;
  // null 表示比赛模式下不限量，调用方据此省略 X-Quota-Remaining。
  remaining: number | null;
}

// 比赛模式（enforceQuota 为 false）依然累加 api_requests_used，只是不再拦截，
// 这样赛后仍能统计每位选手的真实调用次数。
export async function reserveContestantApiRequest(
  contestantId: number,
  enforceQuota = true,
): Promise<ContestantQuotaReservation> {
  await ensureCompetitionSchema();
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `UPDATE competition_users
     SET api_requests_used = api_requests_used + 1
     WHERE id = ? AND role = 'contestant' AND active = TRUE
       AND deleted_at IS NULL${enforceQuota ? " AND api_requests_used < api_request_quota" : ""}`,
    [contestantId],
  );
  if (result.affectedRows === 0) {
    return { allowed: false, remaining: enforceQuota ? 0 : null };
  }
  if (!enforceQuota) return { allowed: true, remaining: null };
  const access = await contestantApiAccess(contestantId);
  return {
    allowed: true,
    remaining: access
      ? Math.max(0, access.requestQuota - access.requestsUsed)
      : 0,
  };
}

// 模式切换后清零已用次数，避免测试期的消耗带进比赛，或比赛期的消耗
// 在切回测试模式时让选手立刻超额。
export async function resetContestantRequestUsage(): Promise<number> {
  await ensureCompetitionSchema();
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `UPDATE competition_users
     SET api_requests_used = 0
     WHERE role = 'contestant' AND deleted_at IS NULL AND api_requests_used > 0`,
  );
  return result.affectedRows;
}

export async function releaseContestantApiRequest(
  contestantId: number,
): Promise<void> {
  await ensureCompetitionSchema();
  await competitionPool().execute(
    `UPDATE competition_users
     SET api_requests_used = api_requests_used - 1
     WHERE id = ? AND api_requests_used > 0`,
    [contestantId],
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
    `UPDATE competition_users SET ${assignments.join(", ")} WHERE id = ?`,
    values,
  );
  if (input.active === false) {
    await competitionPool().execute(
      "UPDATE competition_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL",
      [input.id],
    );
  }
  return result.affectedRows > 0;
}

export async function softDeleteUser(id: number): Promise<boolean> {
  await ensureCompetitionSchema();
  const [result] = await competitionPool().execute<ResultSetHeader>(
    `UPDATE competition_users
     SET deleted_at = CURRENT_TIMESTAMP(3), active = FALSE
     WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  if (result.affectedRows === 0) return false;
  await competitionPool().execute(
    "UPDATE competition_sessions SET revoked_at = CURRENT_TIMESTAMP(3) WHERE user_id = ? AND revoked_at IS NULL",
    [id],
  );
  return true;
}

const questionSelect = `SELECT q.id, q.title, q.content_html, q.status, q.version,
  q.created_at, q.updated_at, q.published_at, q.closed_at,
  u.display_name AS author_name
  FROM competition_questions q
  INNER JOIN competition_users u ON u.id = q.created_by`;

const activeContestantIds = `SELECT cu.id FROM competition_users cu
  WHERE cu.role = 'contestant' AND cu.active = TRUE AND cu.deleted_at IS NULL`;

const answerCountFor = (status: "submitted" | "draft") =>
  `(SELECT COUNT(*) FROM competition_answers a
    WHERE a.question_id = q.id AND a.status = '${status}'
      AND a.contestant_id IN (${activeContestantIds}))`;

const judgeQuestionSelect = `SELECT q.id, q.title, q.content_html, q.status, q.version,
  q.created_at, q.updated_at, q.published_at, q.closed_at,
  u.display_name AS author_name,
  (SELECT COUNT(*) FROM (${activeContestantIds}) roster) AS contestant_total,
  ${answerCountFor("submitted")} AS submitted_count,
  ${answerCountFor("draft")} AS draft_count
  FROM competition_questions q
  INNER JOIN competition_users u ON u.id = q.created_by`;

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
  authorId: number;
  title: string;
  contentHtml: string;
  publish: boolean;
}): Promise<number> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const [result] = await transaction.execute<ResultSetHeader>(
      `INSERT INTO competition_questions
         (title, content_html, status, created_by, published_at)
       VALUES (?, ?, ?, ?, ${input.publish ? "CURRENT_TIMESTAMP(3)" : "NULL"})`,
      [input.title, input.contentHtml, input.publish ? "published" : "draft", input.authorId],
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
    const [result] = await transaction.execute<ResultSetHeader>(
      `UPDATE competition_questions
       SET title = ?, content_html = ?, version = version + 1
       WHERE id = ? AND status = 'draft' AND version = ?`,
      [input.title, input.contentHtml, input.id, input.expectedVersion],
    );
    if (result.affectedRows === 0) return false;
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: input.id });
    return true;
  });
}

export async function publishQuestion(input: {
  id: number;
  title: string;
  contentHtml: string;
  expectedVersion: number;
}): Promise<boolean> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const [result] = await transaction.execute<ResultSetHeader>(
      `UPDATE competition_questions
       SET title = ?, content_html = ?, status = 'published',
           published_at = CURRENT_TIMESTAMP(3), closed_at = NULL, version = version + 1
       WHERE id = ? AND status = 'draft' AND version = ?`,
      [input.title, input.contentHtml, input.id, input.expectedVersion],
    );
    if (result.affectedRows === 0) return false;
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: input.id });
    return true;
  });
}

export async function closeQuestion(id: number): Promise<boolean> {
  await ensureCompetitionSchema();
  const connection = await competitionPool().getConnection();
  return withCompetitionTransaction(connection, async (transaction) => {
    const [result] = await transaction.execute<ResultSetHeader>(
      `UPDATE competition_questions
       SET status = 'closed', closed_at = CURRENT_TIMESTAMP(3), version = version + 1
       WHERE id = ? AND status = 'published'`,
      [id],
    );
    if (result.affectedRows === 0) return false;
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: id });
    return true;
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
