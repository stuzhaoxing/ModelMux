import type { RowDataPacket } from "mysql2";

import { operationModeState } from "@/lib/gateway/operation-mode";

import { rows } from "./db";
import { getCompetitionControl } from "./repository";
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
  api_requests_used: number | string;
  api_input_tokens_used: number | string;
  api_output_tokens_used: number | string;
  api_total_tokens_used: number | string;
  submitted_count: number | string;
  draft_count: number | string;
  first_activity_at: string | null;
  completed_at: string | null;
  last_activity_at: string | null;
}

interface TokenMinuteRow extends RowDataPacket {
  minute_offset: number | string;
  total_tokens: number | string;
}

interface ContestantTokenMinuteRow extends TokenMinuteRow {
  contestant_id: number | string;
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
  const [questionRows, contestantRows, tokenMinuteRows, contestantTokenMinuteRows, modeState, competition] = await Promise.all([
    rows<QuestionSummaryRow[]>(
      `SELECT COUNT(*) AS question_total,
         COALESCE(SUM(status = 'published'), 0) AS published_questions,
         COALESCE(SUM(status = 'closed'), 0) AS closed_questions
       FROM competition_questions
       WHERE status IN ('published', 'closed')`,
    ),
    rows<ContestantScreenRow[]>(
      `SELECT u.id, u.display_name, u.api_requests_used,
         u.api_input_tokens_used, u.api_output_tokens_used, u.api_total_tokens_used,
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
       GROUP BY u.id, u.display_name, u.api_requests_used,
         u.api_input_tokens_used, u.api_output_tokens_used, u.api_total_tokens_used
       ORDER BY u.display_name, u.id`,
    ),
    rows<TokenMinuteRow[]>(
      `SELECT TIMESTAMPDIFF(
           MINUTE,
           DATE_FORMAT(minute_at, '%Y-%m-%d %H:%i:00'),
           DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:%i:00')
         ) AS minute_offset,
         total_tokens
       FROM competition_token_minutes
       WHERE minute_at >= CURRENT_TIMESTAMP(3) - INTERVAL 89 MINUTE
       ORDER BY minute_at`,
    ),
    rows<ContestantTokenMinuteRow[]>(
      `SELECT contestant_id,
         TIMESTAMPDIFF(
           MINUTE,
           DATE_FORMAT(minute_at, '%Y-%m-%d %H:%i:00'),
           DATE_FORMAT(CURRENT_TIMESTAMP(3), '%Y-%m-%d %H:%i:00')
         ) AS minute_offset,
         total_tokens
       FROM competition_contestant_token_minutes
       WHERE minute_at >= CURRENT_TIMESTAMP(3) - INTERVAL 89 MINUTE
       ORDER BY minute_at`,
    ),
    operationModeState(),
    getCompetitionControl(now),
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
  const tokenMinutesByContestant = new Map<number, number[]>();
  for (const row of contestantTokenMinuteRows) {
    const offset = count(row.minute_offset);
    if (offset > 89) continue;
    const contestantId = count(row.contestant_id);
    const minutes = tokenMinutesByContestant.get(contestantId) ?? Array<number>(90).fill(0);
    minutes[89 - offset] = count(row.total_tokens);
    tokenMinutesByContestant.set(contestantId, minutes);
  }
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
      requestCount: count(row.api_requests_used),
      inputTokens: count(row.api_input_tokens_used),
      outputTokens: count(row.api_output_tokens_used),
      totalTokens: count(row.api_total_tokens_used),
      tokenMinutes: tokenMinutesByContestant.get(count(row.id)) ?? Array<number>(90).fill(0),
      lastActivityAt: row.last_activity_at,
      durationSeconds: duration?.seconds ?? null,
      durationKind: duration?.kind ?? null,
    };
  });
  const tokenMinutes = Array<number>(90).fill(0);
  for (const row of tokenMinuteRows) {
    const offset = count(row.minute_offset);
    if (offset <= 89) tokenMinutes[89 - offset] = count(row.total_tokens);
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
    requestCount: contestants.reduce((sum, item) => sum + item.requestCount, 0),
    inputTokens: contestants.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: contestants.reduce((sum, item) => sum + item.outputTokens, 0),
    totalTokens: contestants.reduce((sum, item) => sum + item.totalTokens, 0),
  };

  return {
    generatedAt: new Date(now).toISOString(),
    mode: modeState.mode,
    stage: screenStage,
    schedule,
    competition,
    summary,
    tokenMinutes,
    contestants,
    simulation: null,
  };
}
