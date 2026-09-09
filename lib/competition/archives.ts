import { randomUUID } from "node:crypto";
import type { RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { competitionPool, ensureCompetitionSchema, rows, type SqlValue } from "./db";
import { insertCompetitionEvent } from "./events";
import { withCompetitionTransaction } from "./transaction";
import type { CompetitionArchiveSummary } from "./archive-types";

// Snapshots deliberately have no foreign keys to live accounts/questions. A later
// edit or deletion cannot erase the historical answer or its original identity.
const snapshotQueries = {
  question: "SELECT * FROM competition_questions ORDER BY id FOR UPDATE",
  contestant: "SELECT id, username, display_name, active, deleted_at FROM competition_users WHERE role = 'contestant' ORDER BY id FOR UPDATE",
  answer: "SELECT * FROM competition_answers ORDER BY id FOR UPDATE",
  attachment: "SELECT * FROM competition_attachments WHERE purpose = 'answer' ORDER BY id FOR UPDATE",
  token: "SELECT * FROM competition_token_minutes ORDER BY minute_at FOR UPDATE",
  answer_activity: "SELECT * FROM competition_activity WHERE category = 'answer' ORDER BY id FOR UPDATE",
} as const;
type Kind = keyof typeof snapshotQueries;
type RecordData = Record<string, SqlValue>;
type Snapshot = Record<Kind, RecordData[]>;
interface ArchiveRow extends RowDataPacket {
  id: string;
  reason: CompetitionArchiveSummary["reason"];
  actor_name: string;
  answer_count: number;
  submitted_count: number;
  contestant_count: number;
  created_at: string;
  control_json: RecordData | string;
}
const archiveSelect = "SELECT id, reason, actor_name, answer_count, submitted_count, contestant_count, created_at FROM competition_archives";
function summary(row: ArchiveRow): CompetitionArchiveSummary {
  return { id: row.id, reason: row.reason, actorName: row.actor_name, answerCount: Number(row.answer_count), submittedCount: Number(row.submitted_count), contestantCount: Number(row.contestant_count), createdAt: row.created_at };
}
function decode(value: RecordData | string): RecordData {
  return typeof value === "string" ? JSON.parse(value) as RecordData : value;
}

export async function listCompetitionArchives(): Promise<CompetitionArchiveSummary[]> {
  return (await rows<ArchiveRow[]>(`${archiveSelect} ORDER BY source_generation DESC`)).map(summary);
}

async function readArchive(executor: Pick<PoolConnection, "execute">, id: string) {
  const [headers] = await executor.execute<ArchiveRow[]>("SELECT * FROM competition_archives WHERE id = ?", [id]);
  if (!headers[0]) throw new Error("archive_not_found");
  const [entries] = await executor.execute<(RowDataPacket & { kind: Kind; data: RecordData | string })[]>(
    "SELECT kind, data FROM competition_archive_entries WHERE archive_id = ? ORDER BY kind, row_index", [id],
  );
  const snapshot = Object.fromEntries(Object.keys(snapshotQueries).map((kind) => [kind, []])) as unknown as Snapshot;
  for (const entry of entries) snapshot[entry.kind].push(decode(entry.data));
  return { archive: summary(headers[0]), control: decode(headers[0].control_json), snapshot };
}

export async function getCompetitionArchive(id: string) {
  await ensureCompetitionSchema();
  return readArchive(competitionPool(), id);
}

async function lockControl(transaction: PoolConnection, expectedGeneration: number) {
  const [controls] = await transaction.execute<RowDataPacket[]>(
    `SELECT *, (phase = 'competition' AND status = 'running' AND started_at <= CURRENT_TIMESTAMP(3)
      AND ends_at > CURRENT_TIMESTAMP(3)) AS active FROM competition_control WHERE id = 1 FOR UPDATE`,
  );
  const control = controls[0];
  if (!control) throw new Error("competition_control_missing");
  if (Number(control.generation) !== expectedGeneration) throw new Error("competition_generation_changed");
  if (Number(control.active)) throw new Error("archive_running");
  return control as RecordData;
}

async function capture(transaction: PoolConnection, control: RecordData, reason: CompetitionArchiveSummary["reason"], actorName: string) {
  const snapshot = {} as Snapshot;
  for (const kind of Object.keys(snapshotQueries) as Kind[]) {
    const [data] = await transaction.execute<RowDataPacket[]>(snapshotQueries[kind]);
    snapshot[kind] = data as RecordData[];
  }
  const id = randomUUID();
  await transaction.execute(
    `INSERT INTO competition_archives
     (id, source_generation, reason, actor_name, answer_count, submitted_count, contestant_count, control_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, control.generation, reason, actorName, snapshot.answer.length,
      snapshot.answer.filter((answer) => answer.status === "submitted").length,
      snapshot.contestant.length, JSON.stringify(control)],
  );
  for (const kind of Object.keys(snapshotQueries) as Kind[]) {
    for (const [index, data] of snapshot[kind].entries()) {
      await transaction.execute(
        "INSERT INTO competition_archive_entries (archive_id, kind, row_index, data) VALUES (?, ?, ?, ?)",
        [id, kind, index, JSON.stringify(data)],
      );
    }
  }
  return { id, snapshot };
}

async function clearCurrentAnswers(transaction: PoolConnection) {
  await transaction.execute("DELETE FROM competition_answers");
  await transaction.execute("DELETE FROM competition_token_minutes");
  await transaction.execute("DELETE FROM competition_activity WHERE category = 'answer'");
  // Keep attachments, question definitions, accounts, passwords, API keys and
  // non-answer audit logs. In particular, no media file is deleted by reset.
}
async function notifyQuestions(transaction: PoolConnection, questions: RecordData[]) {
  for (const question of questions) {
    await insertCompetitionEvent(transaction, { type: "question-updated", questionId: Number(question.id) });
    await insertCompetitionEvent(transaction, { type: "answer-updated", questionId: Number(question.id) });
  }
}

export async function resetCompetitionAnswers(expectedGeneration: number, actorName: string) {
  await ensureCompetitionSchema();
  return withCompetitionTransaction(await competitionPool().getConnection(), async (transaction) => {
    const control = await lockControl(transaction, expectedGeneration);
    const saved = await capture(transaction, control, "reset", actorName);
    await clearCurrentAnswers(transaction);
    await transaction.execute(
      `UPDATE competition_control SET generation = generation + 1, phase = 'competition', status = 'not_started',
       started_at = NULL, ends_at = NULL, stopped_at = NULL WHERE id = 1`,
    );
    await notifyQuestions(transaction, saved.snapshot.question);
    return { archiveId: saved.id, generation: expectedGeneration + 1 };
  });
}

// Only these fixed columns can be written back. Snapshot metadata cannot turn
// into SQL identifiers, and question/account contents are never restored over edits.
const restoreTables = {
  answer: { table: "competition_answers", columns: ["id", "question_id", "contestant_id", "content_html", "status", "first_saved_at", "updated_at", "submitted_at"] },
  token: { table: "competition_token_minutes", columns: ["minute_at", "input_tokens", "output_tokens", "total_tokens"] },
  // Allocate fresh log IDs so already-connected event streams see restored rows.
  answer_activity: { table: "competition_activity", columns: ["category", "action", "actor_role", "actor_id", "actor_username", "actor_name", "question_id", "question_title", "detail", "outcome", "created_at"] },
} as const;

export async function restoreCompetitionArchive(id: string, expectedGeneration: number, actorName: string) {
  await ensureCompetitionSchema();
  return withCompetitionTransaction(await competitionPool().getConnection(), async (transaction) => {
    const control = await lockControl(transaction, expectedGeneration);
    const target = await readArchive(transaction, id);
    const backup = await capture(transaction, control, "before_restore", actorName);
    const questions = new Map(backup.snapshot.question.map((row) => [Number(row.id), row]));
    const contestants = new Map(backup.snapshot.contestant.map((row) => [Number(row.id), row]));
    for (const answer of target.snapshot.answer) {
      const question = questions.get(Number(answer.question_id));
      const original = target.snapshot.question.find((row) => Number(row.id) === Number(answer.question_id));
      const contestant = contestants.get(Number(answer.contestant_id));
      if (!question || !original || !contestant || contestant.deleted_at
        || question.content_html !== original.content_html || question.title !== original.title || question.phase !== original.phase) {
        throw new Error("archive_incompatible");
      }
    }
    const attachments = new Map(backup.snapshot.attachment.map((row) => [Number(row.id), row]));
    for (const attachment of target.snapshot.attachment) {
      if (attachments.get(Number(attachment.id))?.storage_name !== attachment.storage_name) throw new Error("archive_incompatible");
    }
    await clearCurrentAnswers(transaction);
    for (const kind of Object.keys(restoreTables) as (keyof typeof restoreTables)[]) {
      const { table, columns } = restoreTables[kind];
      for (const row of target.snapshot[kind]) {
        await transaction.execute(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, columns.map((column) => row[column] ?? null));
      }
    }
    // Restoring answers must not restore historical control fields: started_at
    // also determines the global test/competition mode, even for an ended run.
    // Preserve the current phase, status, duration and clock; only invalidate
    // old browser writes. Historical control stays available in the archive.
    await transaction.execute(
      "UPDATE competition_control SET generation = generation + 1 WHERE id = 1",
    );
    await notifyQuestions(transaction, backup.snapshot.question);
    return { archiveId: backup.id, restoredArchiveId: id, generation: expectedGeneration + 1 };
  });
}
