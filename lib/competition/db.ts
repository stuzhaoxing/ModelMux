import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";

import { generateContestantApiKey } from "./api-access";

export type SqlValue = string | number | boolean | Date | Buffer | null;

declare global {
  var __modelmuxCompetitionPool: Pool | undefined;
  var __modelmuxCompetitionSchema: Promise<void> | undefined;
  var __modelmuxCompetitionSchemaVersion: number | undefined;
}

const competitionSchemaVersion = 14;

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS competition_users (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    role ENUM('judge', 'contestant') NOT NULL,
    username VARCHAR(64) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    event_password VARCHAR(200) NULL,
    api_key VARCHAR(96) NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    deleted_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    last_login_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY competition_users_role_username (role, username),
    UNIQUE KEY competition_users_api_key (api_key),
    KEY competition_users_role_active (role, active),
    KEY competition_users_role_deleted (role, deleted_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_sessions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id BIGINT UNSIGNED NOT NULL,
    token_hash BINARY(32) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    last_seen_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY competition_sessions_token_hash (token_hash),
    KEY competition_sessions_user_expires (user_id, expires_at),
    CONSTRAINT competition_sessions_user_fk FOREIGN KEY (user_id)
      REFERENCES competition_users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_questions (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    title VARCHAR(200) NOT NULL,
    content_html MEDIUMTEXT NOT NULL,
    status ENUM('draft', 'published', 'closed') NOT NULL DEFAULT 'draft',
    version INT UNSIGNED NOT NULL DEFAULT 1,
    created_by BIGINT UNSIGNED NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    published_at DATETIME(3) NULL,
    closed_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    KEY competition_questions_status_time (status, published_at),
    CONSTRAINT competition_questions_author_fk FOREIGN KEY (created_by)
      REFERENCES competition_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_control (
    id TINYINT UNSIGNED NOT NULL,
    status ENUM('not_started', 'running', 'ended') NOT NULL DEFAULT 'not_started',
    duration_minutes BIGINT UNSIGNED NOT NULL DEFAULT 90,
    started_at DATETIME(3) NULL,
    ends_at DATETIME(3) NULL,
    stopped_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `INSERT IGNORE INTO competition_control
     (id, status, duration_minutes, started_at, ends_at, stopped_at)
   VALUES (1, 'not_started', 90, NULL, NULL, NULL)`,
  `CREATE TABLE IF NOT EXISTS competition_answers (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    question_id BIGINT UNSIGNED NOT NULL,
    contestant_id BIGINT UNSIGNED NOT NULL,
    content_html MEDIUMTEXT NOT NULL,
    status ENUM('draft', 'submitted') NOT NULL DEFAULT 'draft',
    first_saved_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
    submitted_at DATETIME(3) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY competition_answers_question_contestant (question_id, contestant_id),
    KEY competition_answers_question_status (question_id, status),
    CONSTRAINT competition_answers_question_fk FOREIGN KEY (question_id)
      REFERENCES competition_questions(id) ON DELETE CASCADE,
    CONSTRAINT competition_answers_contestant_fk FOREIGN KEY (contestant_id)
      REFERENCES competition_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_attachments (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    uploader_id BIGINT UNSIGNED NULL,
    uploader_role ENUM('judge', 'contestant') NOT NULL,
    purpose ENUM('question', 'answer') NOT NULL,
    kind ENUM('image', 'file') NOT NULL DEFAULT 'image',
    storage_name VARCHAR(160) NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(80) NOT NULL,
    byte_size BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    UNIQUE KEY competition_attachments_storage_name (storage_name),
    KEY competition_attachments_uploader (uploader_id, created_at),
    CONSTRAINT competition_attachments_uploader_fk FOREIGN KEY (uploader_id)
      REFERENCES competition_users(id) ON DELETE RESTRICT
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_activity (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    category ENUM('auth', 'answer', 'question', 'model') NOT NULL,
    action VARCHAR(40) NOT NULL,
    actor_role ENUM('judge', 'contestant') NOT NULL,
    actor_id BIGINT UNSIGNED NULL,
    actor_username VARCHAR(64) NOT NULL,
    actor_name VARCHAR(100) NOT NULL,
    question_id BIGINT UNSIGNED NULL,
    question_title VARCHAR(200) NULL,
    detail VARCHAR(200) NULL,
    outcome ENUM('ok', 'warn', 'error') NOT NULL DEFAULT 'ok',
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY competition_activity_created_at (created_at),
    KEY competition_activity_category (category, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
  `CREATE TABLE IF NOT EXISTS competition_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    event_type ENUM('question-updated', 'answer-updated') NOT NULL,
    question_id BIGINT UNSIGNED NOT NULL,
    created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    PRIMARY KEY (id),
    KEY competition_events_created_at (created_at),
    CONSTRAINT competition_events_question_fk FOREIGN KEY (question_id)
      REFERENCES competition_questions(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

function databaseUrl(): string {
  const value = process.env.MODELMUX_DATABASE_URL?.trim();
  if (!value) {
    throw new Error("MODELMUX_DATABASE_URL is not configured");
  }
  return value;
}

export function competitionPool(): Pool {
  if (!globalThis.__modelmuxCompetitionPool) {
    globalThis.__modelmuxCompetitionPool = mysql.createPool({
      uri: databaseUrl(),
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      charset: "utf8mb4",
      dateStrings: true,
    });
  }
  return globalThis.__modelmuxCompetitionPool;
}

export async function ensureCompetitionSchema(): Promise<void> {
  if (globalThis.__modelmuxCompetitionSchemaVersion !== competitionSchemaVersion) {
    globalThis.__modelmuxCompetitionSchema = undefined;
    globalThis.__modelmuxCompetitionSchemaVersion = competitionSchemaVersion;
  }
  if (!globalThis.__modelmuxCompetitionSchema) {
    globalThis.__modelmuxCompetitionSchema = (async () => {
      const pool = competitionPool();
      for (const statement of schemaStatements) {
        await pool.execute(statement);
      }
      const [columns] = await pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_users'
           AND COLUMN_NAME = 'event_password'`,
      );
      if (columns.length === 0) {
        await pool.execute(
          "ALTER TABLE competition_users ADD COLUMN event_password VARCHAR(200) NULL AFTER password_hash",
        );
      }
      const [userDeletedColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_users'
           AND COLUMN_NAME = 'deleted_at'`,
      );
      if (userDeletedColumns.length === 0) {
        await pool.execute(
          "ALTER TABLE competition_users ADD COLUMN deleted_at DATETIME(3) NULL AFTER active",
        );
      }
      const [apiKeyColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_users'
           AND COLUMN_NAME = 'api_key'`,
      );
      if (apiKeyColumns.length === 0) {
        await pool.execute(
          "ALTER TABLE competition_users ADD COLUMN api_key VARCHAR(96) NULL AFTER event_password",
        );
      }
      const [apiKeyIndexes] = await pool.execute<RowDataPacket[]>(
        `SELECT INDEX_NAME
         FROM INFORMATION_SCHEMA.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_users'
           AND INDEX_NAME = 'competition_users_api_key'`,
      );
      if (apiKeyIndexes.length === 0) {
        await pool.execute(
          "ALTER TABLE competition_users ADD UNIQUE KEY competition_users_api_key (api_key)",
        );
      }
      const [contestantsWithoutKeys] = await pool.execute<RowDataPacket[]>(
        `SELECT id FROM competition_users
         WHERE role = 'contestant' AND api_key IS NULL AND deleted_at IS NULL`,
      );
      for (const contestant of contestantsWithoutKeys) {
        await pool.execute(
          `UPDATE competition_users
           SET api_key = ?
           WHERE id = ? AND api_key IS NULL`,
          [
            generateContestantApiKey(),
            Number(contestant.id),
          ],
        );
      }
      const [sessionRevokedColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_sessions'
           AND COLUMN_NAME = 'revoked_at'`,
      );
      if (sessionRevokedColumns.length === 0) {
        await pool.execute(
          "ALTER TABLE competition_sessions ADD COLUMN revoked_at DATETIME(3) NULL AFTER expires_at",
        );
      }
      await pool.execute(
        `UPDATE competition_sessions sessions
         INNER JOIN competition_users users ON users.id = sessions.user_id
         SET sessions.revoked_at = CURRENT_TIMESTAMP(3)
         WHERE users.role = 'judge' AND sessions.revoked_at IS NULL`,
      );
      const [attachmentColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT COLUMN_NAME, DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_attachments'
           AND COLUMN_NAME IN ('kind', 'byte_size')`,
      );
      const attachmentColumnTypes = new Map(
        attachmentColumns.map((column) => [String(column.COLUMN_NAME), String(column.DATA_TYPE)]),
      );
      if (!attachmentColumnTypes.has("kind")) {
        await pool.execute(
          "ALTER TABLE competition_attachments ADD COLUMN kind ENUM('image', 'file') NOT NULL DEFAULT 'image' AFTER purpose",
        );
      }
      if (attachmentColumnTypes.get("byte_size") !== "bigint") {
        await pool.execute(
          "ALTER TABLE competition_attachments MODIFY COLUMN byte_size BIGINT UNSIGNED NOT NULL",
        );
      }
      const [adminOwnedColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, IS_NULLABLE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND (
             (TABLE_NAME = 'competition_questions' AND COLUMN_NAME = 'created_by')
             OR (TABLE_NAME = 'competition_attachments' AND COLUMN_NAME = 'uploader_id')
           )`,
      );
      const nullableByColumn = new Map(
        adminOwnedColumns.map((column) => [
          `${String(column.TABLE_NAME)}.${String(column.COLUMN_NAME)}`,
          String(column.IS_NULLABLE) === "YES",
        ]),
      );
      if (!nullableByColumn.get("competition_questions.created_by")) {
        await pool.execute(
          "ALTER TABLE competition_questions MODIFY COLUMN created_by BIGINT UNSIGNED NULL",
        );
      }
      if (!nullableByColumn.get("competition_attachments.uploader_id")) {
        await pool.execute(
          "ALTER TABLE competition_attachments MODIFY COLUMN uploader_id BIGINT UNSIGNED NULL",
        );
      }
      const [competitionControlColumns] = await pool.execute<RowDataPacket[]>(
        `SELECT DATA_TYPE
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = 'competition_control'
           AND COLUMN_NAME = 'duration_minutes'`,
      );
      if (String(competitionControlColumns[0]?.DATA_TYPE) !== "bigint") {
        await pool.execute(
          "ALTER TABLE competition_control MODIFY COLUMN duration_minutes BIGINT UNSIGNED NOT NULL DEFAULT 90",
        );
      }
    })().catch((error) => {
      globalThis.__modelmuxCompetitionSchema = undefined;
      globalThis.__modelmuxCompetitionSchemaVersion = undefined;
      throw error;
    });
  }
  return globalThis.__modelmuxCompetitionSchema;
}

export async function rows<T extends RowDataPacket[]>(
  statement: string,
  values: SqlValue[] = [],
): Promise<T> {
  await ensureCompetitionSchema();
  const [result] = await competitionPool().execute<T>(statement, values);
  return result;
}

export function isCompetitionDatabaseConfigured(): boolean {
  return Boolean(process.env.MODELMUX_DATABASE_URL?.trim());
}
