"use client";

import {
  Archive,
  CheckCircle2,
  Circle,
  CircleStop,
  Download,
  FileEdit,
  LoaderCircle,
  Send,
  TimerReset,
  UsersRound,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  buildJudgeDashboardSummary,
  formatJudgeCountdown,
} from "@/lib/competition/judge-dashboard";
import { competitionRemainingSeconds } from "@/lib/competition/control";
import type { CompetitionControl, JudgeQuestion } from "@/lib/competition/types";
import { formatCompetitionTime } from "./api";
import { ScreenNoticeEditor } from "./ScreenNoticeEditor";

export function JudgeDashboard({
  questions,
  loading,
  competition,
  durationInput,
  competitionPending,
  onOpenQuestion,
  onManageQuestions,
  onCreateQuestion,
  onDurationChange,
  onStartCompetition,
  onStopCompetition,
  onCompetitionExpired,
}: {
  questions: JudgeQuestion[];
  loading: boolean;
  competition: CompetitionControl;
  durationInput: string;
  competitionPending: boolean;
  onOpenQuestion: (question: JudgeQuestion) => void;
  onManageQuestions: () => void;
  onCreateQuestion: () => void;
  onDurationChange: (value: string) => void;
  onStartCompetition: () => void;
  onStopCompetition: () => void;
  onCompetitionExpired: () => void;
}) {
  const summary = buildJudgeDashboardSummary(questions);
  const answerableQuestions = questions.filter((question) => question.status !== "draft");
  const running = competition.state === "running";
  const ended = competition.state === "ended";
  const canStart = summary.questions.total > 0 && !running;
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const remainingSeconds = competitionRemainingSeconds(competition, now);
  const countdownActive = running && remainingSeconds > 0;

  useEffect(() => {
    if (!running || !competition.endsAt) return;
    if (!countdownActive) {
      onCompetitionExpired();
      return;
    }
    const endsAt = Date.parse(competition.endsAt);
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) onCompetitionExpired();
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [competition.endsAt, countdownActive, onCompetitionExpired, running]);

  async function exportAnswers() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch("/api/competition/judge/answers/export", { cache: "no-store" });
      if (response.status === 401) {
        window.dispatchEvent(new Event("modelmux-admin-unauthorized"));
        return;
      }
      if (response.status === 401) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error || `导出失败（HTTP ${response.status}）`);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = exportFilename(response.headers.get("Content-Disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "答卷导出失败，请稍后重试");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="judge-dashboard">
      <section className={`dashboard-publish-panel ${running ? "started" : "ready"}`}>
        <span className="dashboard-publish-icon">{running ? <TimerReset /> : ended ? <CircleStop /> : <CheckCircle2 />}</span>
        <div className="dashboard-publish-copy">
          <h2>{running ? "比赛进行中" : ended ? "比赛已结束" : "比赛未开始"}</h2>
          <p>{running
            ? `${summary.questions.total} 道题目 · 开始时间 ${formatCompetitionTime(competition.startedAt)}`
            : ended
              ? `${summary.questions.total} 道题目 · 结束时间 ${formatCompetitionTime(competition.stoppedAt ?? competition.endsAt)}`
              : `${summary.questions.total} 道题目等待开始`}</p>
        </div>
        {running ? (
          <div className="dashboard-publish-controls">
            <div className="dashboard-publish-countdown" data-finished={remainingSeconds === 0} aria-live="polite">
              <span>比赛剩余时间</span>
              <strong>{formatJudgeCountdown(remainingSeconds)}</strong>
            </div>
            <button
              type="button"
              className="secondary-action danger"
              disabled={competitionPending}
              title="停止比赛并立即对选手隐藏题目"
              onClick={onStopCompetition}
            >
              {competitionPending ? <LoaderCircle className="spinning" /> : <CircleStop />}
              {competitionPending ? "正在停止" : "停止比赛"}
            </button>
          </div>
        ) : (
          <div className="dashboard-start-controls">
            <label>
              <span>比赛时长</span>
              <span><input type="number" min="1" step="1" inputMode="numeric" value={durationInput} disabled={competitionPending} onChange={(event) => onDurationChange(event.target.value)} /> 分钟</span>
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={!canStart || competitionPending}
              aria-busy={competitionPending}
              onClick={onStartCompetition}
            >
              {competitionPending ? <LoaderCircle className="spinning" /> : <Send />}
              {competitionPending ? "正在开始" : ended ? "重新开始比赛" : summary.questions.total === 0 ? "暂无题目" : "开始比赛"}
            </button>
          </div>
        )}
      </section>

      <ScreenNoticeEditor competitionState={competition.state} />

      <section className="dashboard-panel dashboard-answer-overview">
        <div className="dashboard-panel-heading">
          <div><span>ANSWER OVERVIEW</span><h2>全部题目答题概览</h2></div>
          <div className="dashboard-panel-heading-actions">
            <small>{summary.answers.questionCount} 道题目已有答题记录</small>
            <button type="button" className="primary-action" title="进入题目管理" onClick={onManageQuestions}>
              <FileEdit />题目管理
            </button>
          </div>
        </div>
        <div className="dashboard-answer-body">
          <div className="dashboard-completion">
            <span>总体提交率</span>
            <strong>{summary.answers.submissionRate}<small>%</small></strong>
            <div className="dashboard-progress-track" aria-label={`总体提交率 ${summary.answers.submissionRate}%`}>
              <i style={{ width: `${summary.answers.submissionRate}%` }} />
            </div>
            <small>{summary.answers.submitted} / {summary.answers.total} 份已提交</small>
          </div>
          <div className="dashboard-answer-counts">
            <AnswerCount label="答卷总数" value={summary.answers.total} icon={<UsersRound />} />
            <AnswerCount label="已提交" value={summary.answers.submitted} icon={<CheckCircle2 />} tone="submitted" />
            <AnswerCount label="草稿中" value={summary.answers.drafting} icon={<FileEdit />} tone="drafting" />
            <AnswerCount label="未开始" value={summary.answers.notStarted} icon={<Circle />} />
          </div>
        </div>
      </section>

      <section className="dashboard-panel dashboard-question-overview">
        <div className="dashboard-panel-heading">
          <div><span>QUESTION STATUS</span><h2>逐题答题进度</h2></div>
          <small>共 {questions.length} 道题</small>
        </div>
        <div className="dashboard-question-table-wrap">
          <table className="dashboard-question-table">
            <thead>
              <tr>
                <th>题目</th>
                <th>比赛状态</th>
                <th>本轮开始</th>
                <th>已提交</th>
                <th>草稿中</th>
                <th>未开始</th>
                <th><span className="visually-hidden">操作</span></th>
              </tr>
            </thead>
            <tbody>
              {questions.map((question) => {
                const answerable = question.status !== "draft";
                const rate = answerable && question.progress.total > 0
                  ? Math.round((question.progress.submitted / question.progress.total) * 100)
                  : 0;
                return (
                  <tr key={question.id}>
                    <td data-label="题目"><strong>{question.title}</strong></td>
                    <td data-label="比赛状态"><span className={`dashboard-status ${competition.state}`}><i />{competitionStatusLabel(competition)}</span></td>
                    <td data-label="本轮开始">{competition.startedAt ? formatCompetitionTime(competition.startedAt) : "尚未开始"}</td>
                    <td data-label="已提交">
                      {answerable ? (
                        <span className="dashboard-row-progress">
                          <span><strong>{question.progress.submitted}</strong> / {question.progress.total}</span>
                          <i><b style={{ width: `${rate}%` }} /></i>
                        </span>
                      ) : "--"}
                    </td>
                    <td data-label="草稿中">{answerable ? question.progress.drafting : "--"}</td>
                    <td data-label="未开始">{answerable ? question.progress.notStarted : "--"}</td>
                    <td className="dashboard-row-action">
                      <button type="button" onClick={() => onOpenQuestion(question)}>
                        {answerable ? "查看答卷" : "编辑题目"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && questions.length === 0 && (
            <div className="dashboard-empty"><FileEdit /><strong>还没有考核题目</strong><button type="button" onClick={onCreateQuestion}>新建第一道题目</button></div>
          )}
        </div>
      </section>

      <section className="dashboard-export-panel">
        <span className="dashboard-export-icon"><Archive /></span>
        <div>
          <h2>全部答卷归档</h2>
          <p>{answerableQuestions.length} 道题目，覆盖 {summary.answers.total} 份选手答题记录</p>
          {exportError && <span className="dashboard-export-error" role="status">{exportError}</span>}
        </div>
        <button
          type="button"
          className="primary-action"
          disabled={exporting}
          aria-busy={exporting}
          onClick={() => void exportAnswers()}
        >
          {exporting ? <LoaderCircle className="spinning" /> : <Download />}
          {exporting ? "正在生成答卷" : "导出全部答卷"}
        </button>
      </section>
    </div>
  );
}

function AnswerCount({
  label,
  value,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "neutral" | "submitted" | "drafting";
}) {
  return <div className={`dashboard-answer-count ${tone}`}><span>{icon}{label}</span><strong>{value}</strong></div>;
}

function competitionStatusLabel(competition: CompetitionControl): string {
  return competition.state === "running" ? "作答中" : competition.state === "ended" ? "已停止" : "未开始";
}

function exportFilename(contentDisposition: string | null): string {
  const encodedName = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (!encodedName) return "全部答卷.zip";
  try {
    return decodeURIComponent(encodedName);
  } catch {
    return "全部答卷.zip";
  }
}
