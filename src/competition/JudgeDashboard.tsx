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
import { useState } from "react";

import {
  buildJudgeDashboardSummary,
} from "@/lib/competition/judge-dashboard";
import { competitionIsTesting } from "@/lib/competition/control";
import type { CompetitionControl, JudgeQuestion, QuestionPhase } from "@/lib/competition/types";
import { formatCompetitionTime } from "./api";
import { JudgeCompetitionCountdown } from "./JudgeCompetitionCountdown";
import { CompetitionResetPanel } from "./CompetitionResetPanel";
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
  onAnswersChanged,
  onArchivePendingChange,
  phase = "competition",
  testQuestionCount = 0,
  competitionQuestionCount = questions.length,
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
  onAnswersChanged?: () => Promise<void>;
  onArchivePendingChange?: (pending: boolean) => void;
  phase?: QuestionPhase;
  testQuestionCount?: number;
  competitionQuestionCount?: number;
}) {
  const summary = buildJudgeDashboardSummary(questions);
  const answerableQuestions = questions.filter((question) => question.status !== "draft");
  const testing = competitionIsTesting(competition);
  const running = !testing && competition.state === "running";
  const ended = !testing && competition.state === "ended";
  const canStart = competitionQuestionCount > 0 && testing;
  const phaseLabel = phase === "test" ? "测试题目" : "正式赛题";
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  async function exportAnswers() {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const response = await fetch(`/api/competition/judge/answers/export?phase=${phase}`, { cache: "no-store" });
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
          <h2>{testing ? "测试" : running ? "比赛中" : "比赛已结束"}</h2>
          <p>{running
            ? `${competitionQuestionCount} 道正式赛题 · 开始时间 ${formatCompetitionTime(competition.startedAt)}`
            : ended
              ? `${summary.questions.total} 道题目 · 结束时间 ${formatCompetitionTime(competition.stoppedAt ?? competition.endsAt)}`
              : `${testQuestionCount} 道测试题 · 测试不限时，开始正式比赛后自动切换`}</p>
        </div>
        {running ? (
          <div className="dashboard-publish-controls">
            <JudgeCompetitionCountdown competition={competition} onExpired={onCompetitionExpired} />
            <button
              type="button"
              className="secondary-action danger"
              disabled={competitionPending}
              title="立即结束比赛，停止选手作答并保留已保存的答案"
              onClick={onStopCompetition}
            >
              {competitionPending ? <LoaderCircle className="spinning" /> : <CircleStop />}
              {competitionPending ? "正在结束" : "立即结束比赛"}
            </button>
          </div>
        ) : null}
        {testing && (
          <div className="dashboard-start-controls">
            <label>
              <span>比赛时长</span>
              <span><input type="number" min="1" step="1" inputMode="numeric" value={durationInput} disabled={competitionPending} onChange={(event) => onDurationChange(event.target.value)} /> 分钟</span>
            </label>
            <button
              type="button"
              className="primary-action"
              disabled={!canStart || competitionPending || loading}
              aria-busy={competitionPending}
              onClick={onStartCompetition}
            >
              {competitionPending ? <LoaderCircle className="spinning" /> : <Send />}
              {competitionPending ? "正在开始" : competitionQuestionCount === 0 ? "暂无正式赛题" : "开始比赛"}
            </button>
          </div>
        )}
        {ended && (
          <div className="dashboard-start-controls">
            <span>归档并重置后回到测试，可开始下一场比赛</span>
            <a className="primary-action" href="#competition-reset-panel"><Archive />前往归档并重置</a>
          </div>
        )}
      </section>

      <ScreenNoticeEditor competitionState={competition.state} />

      <section className="dashboard-panel dashboard-answer-overview">
        <div className="dashboard-panel-heading">
          <div><span>ANSWER OVERVIEW</span><h2>{phaseLabel}答题概览</h2></div>
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
            <AnswerCount label="应交答卷" value={summary.answers.total} icon={<UsersRound />} />
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
                    <td data-label="比赛状态"><span className={`dashboard-status ${question.phase === competition.phase ? competition.state : "not_started"}`}><i />{question.phase === "test" && testing ? "测试中" : question.phase === competition.phase ? competitionStatusLabel(competition) : question.status === "draft" ? "未开始" : "已停止"}</span></td>
                    <td data-label="本轮开始">{question.phase === competition.phase && competition.startedAt ? formatCompetitionTime(competition.startedAt) : "--"}</td>
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
          <h2>{phaseLabel}答卷归档</h2>
          <p>{answerableQuestions.length} 道题目，覆盖 {summary.answers.submitted + summary.answers.drafting} 份已保存答题记录</p>
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
          {exporting ? "正在生成答卷" : `导出${phaseLabel}答卷`}
        </button>
      </section>
      <CompetitionResetPanel competition={competition} disabled={competitionPending || loading} onChanged={onAnswersChanged} onPendingChange={onArchivePendingChange} />
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
