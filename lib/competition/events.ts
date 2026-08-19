import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";

import { rows } from "./db";
import type { CompetitionEvent } from "./types";

interface EventRow extends RowDataPacket {
  id: number;
  event_type: CompetitionEvent["type"];
  question_id: number;
  created_at: string;
}

export interface StoredCompetitionEvent extends CompetitionEvent {
  id: number;
}

export async function latestCompetitionEventId(): Promise<number> {
  const result = await rows<(RowDataPacket & { id: number })[]>(
    "SELECT COALESCE(MAX(id), 0) AS id FROM competition_events",
  );
  return Number(result[0]?.id ?? 0);
}

export async function competitionEventsAfter(id: number): Promise<StoredCompetitionEvent[]> {
  const result = await rows<EventRow[]>(
    `SELECT id, event_type, question_id, created_at
     FROM competition_events WHERE id > ? ORDER BY id ASC LIMIT 100`,
    [id],
  );
  return result.map((row) => ({
    id: Number(row.id),
    type: row.event_type,
    questionId: Number(row.question_id),
    at: row.created_at,
  }));
}

export async function insertCompetitionEvent(
  connection: PoolConnection,
  event: Pick<CompetitionEvent, "type" | "questionId">,
): Promise<number> {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO competition_events (event_type, question_id)
     VALUES (?, ?)`,
    [event.type, event.questionId],
  );
  return Number(result.insertId);
}

export function coalesceCompetitionEvents(
  events: StoredCompetitionEvent[],
): StoredCompetitionEvent[] {
  const latestBySubject = new Map<string, StoredCompetitionEvent>();
  for (const event of events) {
    latestBySubject.set(`${event.type}:${event.questionId}`, event);
  }
  return [...latestBySubject.values()].sort((left, right) => left.id - right.id);
}
