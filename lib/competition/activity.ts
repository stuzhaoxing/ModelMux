import type { RowDataPacket } from "mysql2";

import { competitionPool, ensureCompetitionSchema, rows } from "./db";
import type { ActivityEntry } from "./types";

interface ActivityRow extends RowDataPacket {
  id: number;
  category: ActivityEntry["category"];
  action: ActivityEntry["action"];
  actor_role: ActivityEntry["actorRole"];
  actor_id: number | null;
  actor_username: string;
  actor_name: string;
  question_id: number | null;
  question_title: string | null;
  detail: string | null;
  outcome: ActivityEntry["outcome"];
  created_at: string;
}

export type ActivityInput = Omit<ActivityEntry, "id" | "at"> & {
  outcome?: ActivityEntry["outcome"];
};

const activitySelect = `SELECT id, category, action, actor_role, actor_id,
  actor_username, actor_name, question_id, question_title, detail, outcome, created_at
  FROM competition_activity`;

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(300, Math.trunc(limit)));
}

function toEntry(row: ActivityRow): ActivityEntry {
  return {
    id: Number(row.id),
    category: row.category,
    action: row.action,
    actorRole: row.actor_role,
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    actorUsername: row.actor_username,
    actorName: row.actor_name,
    questionId: row.question_id === null ? null : Number(row.question_id),
    questionTitle: row.question_title,
    detail: row.detail,
    outcome: row.outcome,
    at: row.created_at,
  };
}

/**
 * The activity feed is a log, never a source of truth: a failed write must not
 * break the action that produced it (a saved answer, a proxied model call).
 */
export async function recordActivity(input: ActivityInput): Promise<void> {
  try {
    await ensureCompetitionSchema();
    await competitionPool().execute(
      `INSERT INTO competition_activity
         (category, action, actor_role, actor_id, actor_username, actor_name,
          question_id, question_title, detail, outcome)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.category,
        input.action,
        input.actorRole,
        input.actorId,
        input.actorUsername.slice(0, 64),
        input.actorName.slice(0, 100),
        input.questionId,
        input.questionTitle === null ? null : input.questionTitle.slice(0, 200),
        input.detail === null ? null : input.detail.slice(0, 200),
        input.outcome ?? "ok",
      ],
    );
  } catch (error) {
    console.error("[competition] 现场日志写入失败", error);
  }
}

export async function latestActivityId(): Promise<number> {
  const result = await rows<(RowDataPacket & { id: number })[]>(
    "SELECT COALESCE(MAX(id), 0) AS id FROM competition_activity",
  );
  return Number(result[0]?.id ?? 0);
}

/** Ascending, for streaming everything a judge has not seen yet. */
export async function activityAfter(id: number, limit = 60): Promise<ActivityEntry[]> {
  const result = await rows<ActivityRow[]>(
    `${activitySelect} WHERE id > ? ORDER BY id ASC LIMIT ${clampLimit(limit)}`,
    [id],
  );
  return result.map(toEntry);
}

/** Descending, for the initial load of the judge log panel. */
export async function recentActivity(limit = 120): Promise<ActivityEntry[]> {
  const result = await rows<ActivityRow[]>(
    `${activitySelect} ORDER BY id DESC LIMIT ${clampLimit(limit)}`,
  );
  return result.map(toEntry);
}

/** Descending, for paging back through everything already on record. */
export async function activityBefore(id: number, limit = 120): Promise<ActivityEntry[]> {
  const result = await rows<ActivityRow[]>(
    `${activitySelect} WHERE id < ? ORDER BY id DESC LIMIT ${clampLimit(limit)}`,
    [id],
  );
  return result.map(toEntry);
}

export async function activityTotal(): Promise<number> {
  const result = await rows<(RowDataPacket & { total: number })[]>(
    "SELECT COUNT(*) AS total FROM competition_activity",
  );
  return Number(result[0]?.total ?? 0);
}
