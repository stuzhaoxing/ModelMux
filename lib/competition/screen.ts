import type { RowDataPacket } from "mysql2";

import { operationModeState } from "@/lib/gateway/operation-mode";

import { rows } from "./db";
import { getCompetitionControl, getCompetitionScreenNotice } from "./repository";
import {
  competitionCountdownMinutes,
  competitionScreenContestantStatus,
  competitionScreenDisplayStatus,
  competitionScreenDuration,
  competitionScreenScheduleFromStart,
  competitionScreenStageAt,
  type CompetitionScreenSnapshot,
} from "./screen-model";

interface QuestionSummaryRow extends RowDataPacket {
  question_total: number | string;
  published_questions: number | string;
  closed_questions: number | string;
}

interface ContestantScreenRow extends RowDataPacket {
  id: number | string;
  display_name: string;
  submitted_count: number | string;
  draft_count: number | string;
  first_activity_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
}

interface TokenMinuteRow extends RowDataPacket {
  minute_at: string;
  total_tokens: number | string;
}

interface TokenTotalRow extends RowDataPacket {
  total_tokens: number | string;
}

function count(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function competitionTimestamp(value: string | null): number | null {
  if (!value) return null;
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}+08:00`;
  const timestamp = Date.parse(normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export async function getCompetitionScreenSnapshot(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<CompetitionScreenSnapshot> {
  const [modeState, competition, notice] = await Promise.all([
    operationModeState(),
    getCompetitionControl(now),
    getCompetitionScreenNotice(),
  ]);
  const usageStartedAt = competition.startedAt ? Date.parse(competition.startedAt) : null;
  const usageStoppedAt = competition.stoppedAt
    ? Date.parse(competition.stoppedAt)
    : competition.endsAt
      ? Math.min(now, Date.parse(competition.endsAt))
      : now;
  const usageQueryValues = usageStartedAt === null || !Number.isFinite(usageStoppedAt)
    ? null
    : [Math.floor(usageStartedAt / 1_000), Math.floor(usageStoppedAt / 1_000)];
  const recentUsageStartedAt = Math.max(
    usageStartedAt ?? usageStoppedAt,
    usageStoppedAt - 89 * 60_000,
  );
  const [questionRows, contestantRows, tokenTotalRows, tokenMinuteRows] = await Promise.all([
    rows<QuestionSummaryRow[]>(
      `SELECT COUNT(*) AS question_total,
         COALESCE(SUM(status = 'published'), 0) AS published_questions,
         COALESCE(SUM(status = 'closed'), 0) AS closed_questions
       FROM competition_questions
       WHERE status IN ('published', 'closed')`,
    ),
    rows<ContestantScreenRow[]>(
      `SELECT u.id, u.display_name,
         COALESCE(SUM(q.id IS NOT NULL AND a.status = 'submitted'), 0) AS submitted_count,
         COALESCE(SUM(q.id IS NOT NULL AND a.status = 'draft'), 0) AS draft_count,
         MIN(CASE WHEN q.id IS NOT NULL THEN a.first_saved_at ELSE NULL END) AS first_activity_at,
         MAX(CASE WHEN q.id IS NOT NULL AND a.status = 'submitted' THEN a.submitted_at ELSE NULL END) AS completed_at,
         MAX(CASE WHEN q.id IS NOT NULL THEN a.updated_at ELSE NULL END) AS last_activity_at
       FROM competition_users u
       LEFT JOIN competition_answers a ON a.contestant_id = u.id
       LEFT JOIN competition_questions q
         ON q.id = a.question_id AND q.status IN ('published', 'closed')
       WHERE u.role = 'contestant' AND u.active = TRUE AND u.deleted_at IS NULL
       GROUP BY u.id, u.display_name
       ORDER BY u.display_name, u.id`,
    ),
    usageQueryValues === null
      ? Promise.resolve([] as TokenTotalRow[])
      : rows<TokenTotalRow[]>(
          `SELECT COALESCE(SUM(total_tokens), 0) AS total_tokens
           FROM competition_token_minutes
           WHERE minute_at >= FROM_UNIXTIME(?)
             AND minute_at <= FROM_UNIXTIME(?)`,
          usageQueryValues,
        ),
    usageQueryValues === null
      ? Promise.resolve([] as TokenMinuteRow[])
      : rows<TokenMinuteRow[]>(
          `SELECT minute_at, total_tokens
           FROM competition_token_minutes
           WHERE minute_at >= FROM_UNIXTIME(?)
             AND minute_at <= FROM_UNIXTIME(?)
           ORDER BY minute_at`,
          [Math.floor(recentUsageStartedAt / 1_000), Math.floor(usageStoppedAt / 1_000)],
        ),
  ]);

  const questionRow = questionRows[0];
  const questionTotal = count(questionRow?.question_total);
  const publishedQuestions = count(questionRow?.published_questions);
  const closedQuestions = count(questionRow?.closed_questions);
  const eventStartedAt = competition.startedAt ? Date.parse(competition.startedAt) : null;
  const schedule = competition.startedAt && competition.endsAt
    ? { configured: true, startAt: competition.startedAt, endAt: competition.endsAt }
    : competitionScreenScheduleFromStart(null, competitionCountdownMinutes(env));
  const screenStage = competitionScreenStageAt({
    schedule,
    mode: modeState.mode,
    questionTotal,
    publishedQuestions,
    closedQuestions,
    competitionState: competition.state,
    now,
  });
  const eventEndedAt = screenStage === "finished"
    ? competition.stoppedAt
      ? Date.parse(competition.stoppedAt)
      : competition.endsAt
        ? Date.parse(competition.endsAt)
        : null
    : null;
  const contestants = contestantRows.map((row) => {
    const submitted = Math.min(questionTotal, count(row.submitted_count));
    const drafting = Math.min(
      Math.max(0, questionTotal - submitted),
      count(row.draft_count),
    );
    const progressStatus = competitionScreenContestantStatus({ questionTotal, submitted, drafting });
    const status = competitionScreenDisplayStatus({ status: progressStatus, stage: screenStage, questionTotal });
    const completedAt = competitionTimestamp(row.completed_at);
    const duration = competitionScreenDuration({
      status,
      startedAt: eventStartedAt ?? competitionTimestamp(row.first_activity_at),
      completedAt,
      eventEndedAt,
    });
    return {
      id: count(row.id),
      name: row.display_name,
      status,
      submitted,
      drafting,
      notStarted: Math.max(0, questionTotal - submitted - drafting),
      lastActivityAt: row.last_activity_at,
      durationSeconds: duration?.seconds ?? null,
      durationKind: duration?.kind ?? null,
    };
  });
  const tokenMinutes = Array<number>(90).fill(0);
  const referenceMinute = Math.floor(usageStoppedAt / 60_000);
  const totalTokens = count(tokenTotalRows[0]?.total_tokens);
  for (const row of tokenMinuteRows) {
    const minuteTokens = count(row.total_tokens);
    const minuteAt = competitionTimestamp(row.minute_at);
    if (minuteAt === null) continue;
    const offset = referenceMinute - Math.floor(minuteAt / 60_000);
    if (offset >= 0 && offset < tokenMinutes.length) {
      tokenMinutes[tokenMinutes.length - 1 - offset] = minuteTokens;
    }
  }
  const summary = {
    contestantTotal: contestants.length,
    questionTotal,
    publishedQuestions,
    closedQuestions,
    fullySubmitted: contestants.filter((item) => item.status === "submitted").length,
    unfinished: contestants.filter((item) => item.status === "unfinished").length,
    drafting: contestants.filter((item) => item.status === "drafting").length,
    notStarted: contestants.filter((item) => item.status === "not_started").length,
    totalTokens,
  };

  return {
    generatedAt: new Date(now).toISOString(),
    mode: modeState.mode,
    stage: screenStage,
    schedule,
    competition,
    notice,
    summary,
    tokenMinutes,
    contestants,
    simulation: null,
  };
}
