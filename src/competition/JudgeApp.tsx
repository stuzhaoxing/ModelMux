"use client";

import {
  CheckCircle2,
  Circle,
  Clock3,
  FileEdit,
  FilePlus2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Send,
  Trash2,
  UsersRound,
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  adminJudgeViewFromPathname,
  adminJudgeViewPaths,
  type AdminJudgeView,
} from "@/lib/admin/navigation";
import { competitionAllowsQuestionManagement } from "@/lib/competition/control";
import { eventStreamRetryDelayMs } from "@/lib/competition/event-stream";
import {
  questionTitleIsWithinLimit,
  questionTitleLength,
  questionTitleMaxLength,
} from "@/lib/competition/question";
import type { ActivityEntry, CompetitionControl, CompetitionQuestion, JudgeAnswerRow, JudgeQuestion } from "@/lib/competition/types";
import type { OperationMode } from "@/lib/gateway/operation-mode";
import { apiRequest, formatCompetitionTime } from "./api";
import { JudgeDashboard } from "./JudgeDashboard";
import { useOperationMode } from "./OperationModeBanner";
import { PreviewableRichContent } from "./PreviewableRichContent";
import { RichTextEditor } from "./RichTextEditor";

export default function JudgeApp() {
  const pathname = usePathname();
  const view = adminJudgeViewFromPathname(pathname);
  const initialViewRef = useRef(view);
  const editorVersionRef = useRef<number | null>(null);
  const answersRequestRef = useRef(0);
  const answerRefreshTimerRef = useRef<number | null>(null);
  const queueRefreshTimerRef = useRef<number | null>(null);
  const [questions, setQuestions] = useState<JudgeQuestion[]>([]);
  const [competition, setCompetition] = useState<CompetitionControl>({ state: "not_started", durationMinutes: 90, startedAt: null, endsAt: null, stoppedAt: null });
  const [durationInput, setDurationInput] = useState("90");
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [answers, setAnswers] = useState<JudgeAnswerRow[]>([]);
  const [selectedContestantId, setSelectedContestantId] = useState<number | null>(null);
  const { setMode } = useOperationMode();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");

  const selectedQuestion = selectedId === "new" ? null : questions.find((item) => item.id === selectedId) ?? null;
  const selectedAnswer = answers.find((item) => item.contestantId === selectedContestantId) ?? null;
  const questionManagementEnabled = competitionAllowsQuestionManagement(competition.state);
  const questionEditable = questionManagementEnabled && (selectedId === "new" || selectedQuestion !== null);

  const loadQuestions = useCallback(async (retainSelection = true) => {
    const result = await apiRequest<JudgeQuestionsResponse>("/api/competition/judge/questions");
    setQuestions(result.questions);
    setCompetition(result.competition);
    if (result.competition.state !== "running") setDurationInput(String(result.competition.durationMinutes));
    setSelectedId((current) => {
      if (current === "new") return current;
      if (retainSelection && current && result.questions.some((item) => item.id === current)) return current;
      return result.questions[0]?.id ?? "new";
    });
  }, []);

  const loadAnswers = useCallback(async (questionId: number) => {
    const requestId = ++answersRequestRef.current;
    const result = await apiRequest<{ answers: JudgeAnswerRow[] }>(`/api/competition/judge/questions/${questionId}/answers`);
    if (requestId !== answersRequestRef.current) return;
    setAnswers(result.answers);
    setSelectedContestantId((current) => current && result.answers.some((item) => item.contestantId === current) ? current : result.answers[0]?.contestantId ?? null);
  }, []);

  useEffect(() => {
    apiRequest<JudgeQuestionsResponse>("/api/competition/judge/questions")
      .then(async (workspace) => {
        setQuestions(workspace.questions);
        setCompetition(workspace.competition);
        if (workspace.competition.state !== "running") setDurationInput(String(workspace.competition.durationMinutes));
        const requestedFirst = initialViewRef.current === "answers"
          ? workspace.questions.find((question) => question.status !== "draft")
          : workspace.questions[0];
        const first = requestedFirst ?? workspace.questions[0];
        if (initialViewRef.current === "answers" && !requestedFirst) {
          window.history.replaceState(null, "", adminJudgeViewPaths.questions);
        }
        setSelectedId(first?.id ?? "new");
        setTitle(first?.title ?? "");
        setContentHtml(first?.contentHtml ?? "");
        editorVersionRef.current = first?.version ?? null;
        if (first && first.status !== "draft") await loadAnswers(first.id);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "题目读取失败"))
      .finally(() => setLoading(false));
  }, [loadAnswers]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;
    let stopped = false;
    const scheduleAnswerReload = (questionId: number) => {
      if (answerRefreshTimerRef.current !== null) window.clearTimeout(answerRefreshTimerRef.current);
      answerRefreshTimerRef.current = window.setTimeout(() => {
        answerRefreshTimerRef.current = null;
        void loadAnswers(questionId).catch((loadError) => {
          setError(loadError instanceof Error ? loadError.message : "答题进度读取失败");
        });
      }, 120);
    };
    const scheduleQueueReload = () => {
      if (queueRefreshTimerRef.current !== null) window.clearTimeout(queueRefreshTimerRef.current);
      queueRefreshTimerRef.current = window.setTimeout(() => {
        queueRefreshTimerRef.current = null;
        void loadQuestions(true).catch(() => undefined);
      }, 400);
    };
    const scheduleReconnect = () => {
      if (stopped || retryTimer !== null) return;
      attempt += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, eventStreamRetryDelayMs(attempt));
    };

    const connect = () => {
      if (stopped) return;
      const stream = new EventSource("/api/competition/events?role=judge");
      source = stream;
      stream.addEventListener("connected", (event) => {
        attempt = 0;
        const data = JSON.parse((event as MessageEvent).data) as { mode?: OperationMode };
        if (data.mode) setMode(data.mode);
        void loadQuestions(true);
        if (typeof selectedId === "number") scheduleAnswerReload(selectedId);
      });
      stream.addEventListener("mode", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { mode: OperationMode };
        setMode(data.mode);
      });
      stream.addEventListener("activity", (event) => {
        const entries = JSON.parse((event as MessageEvent).data) as ActivityEntry[];
        const deletedQuestionIds = entries
          .filter((entry) => entry.action === "question-deleted" && entry.questionId !== null)
          .map((entry) => entry.questionId);
        if (typeof selectedId === "number" && deletedQuestionIds.includes(selectedId)) {
          window.location.reload();
        } else if (deletedQuestionIds.length > 0) {
          void loadQuestions(true);
        }
      });
      stream.addEventListener("question-updated", () => void loadQuestions(true));
      stream.addEventListener("answer-updated", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { questionId: number };
        scheduleQueueReload();
        if (typeof selectedId === "number" && data.questionId === selectedId) scheduleAnswerReload(selectedId);
      });
      stream.onopen = () => {
        attempt = 0;
      };
      stream.onerror = () => {
        // 浏览器只在连接被掐断时自己重连，服务重启返回 502 时它会直接放弃。
        if (stream.readyState !== EventSource.CLOSED) return;
        stream.close();
        scheduleReconnect();
      };
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      source?.close();
      if (answerRefreshTimerRef.current !== null) window.clearTimeout(answerRefreshTimerRef.current);
      answerRefreshTimerRef.current = null;
      if (queueRefreshTimerRef.current !== null) window.clearTimeout(queueRefreshTimerRef.current);
      queueRefreshTimerRef.current = null;
    };
  }, [loadAnswers, loadQuestions, selectedId, setMode]);

  const progress = useMemo(() => ({
    total: answers.length,
    submitted: answers.filter((answer) => answer.status === "submitted").length,
    drafting: answers.filter((answer) => answer.status === "draft").length,
  }), [answers]);

  async function saveQuestion() {
    if (!title.trim()) {
      setError("题目标题不能为空");
      return;
    }
    if (!questionTitleIsWithinLimit(title.trim())) {
      setError(`题目标题不能超过 ${questionTitleMaxLength} 字`);
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (selectedId === "new") {
        const result = await apiRequest<{ id: number; question: CompetitionQuestion }>("/api/competition/judge/questions", {
          method: "POST",
          body: JSON.stringify({ title, contentHtml }),
        });
        await loadQuestions(false);
        setSelectedId(result.id);
        setTitle(result.question.title);
        setContentHtml(result.question.contentHtml);
        editorVersionRef.current = result.question.version;
      } else if (selectedQuestion && questionManagementEnabled) {
        const result = await apiRequest<{ question: CompetitionQuestion }>(`/api/competition/judge/questions/${selectedQuestion.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            action: "update",
            title,
            contentHtml,
            expectedVersion: editorVersionRef.current ?? selectedQuestion.version,
          }),
        });
        setTitle(result.question.title);
        setContentHtml(result.question.contentHtml);
        editorVersionRef.current = result.question.version;
        await loadQuestions(true);
      }
      setNotice("题目已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "题目保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function startCompetition() {
    const durationMinutes = Number(durationInput);
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes < 1) {
      setError("比赛时长必须是大于 0 的整数");
      return;
    }
    if (!window.confirm(`开始后，选手将立即看到全部题目并可以作答，本次比赛限时 ${durationMinutes} 分钟。确认开始？`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<JudgeQuestionsResponse>(
        "/api/competition/judge/competition/start",
        { method: "POST", body: JSON.stringify({ durationMinutes }) },
      );
      setQuestions(result.questions);
      setCompetition(result.competition);
      setDurationInput(String(result.competition.durationMinutes));
      setNotice(`比赛已开始，选手可见 ${result.questions.length} 道题目`);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "开始比赛失败");
    } finally {
      setSaving(false);
    }
  }

  async function stopCompetition() {
    if (!window.confirm("停止后，选手将立即看不到题目且不能继续保存或提交答案。已有答案会保留，确认停止比赛？")) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<JudgeQuestionsResponse>(
        "/api/competition/judge/competition/stop",
        { method: "POST" },
      );
      setQuestions(result.questions);
      setCompetition(result.competition);
      setDurationInput(String(result.competition.durationMinutes));
      setNotice("比赛已停止，题目已对选手隐藏并恢复编辑");
    } catch (stopError) {
      setError(stopError instanceof Error ? stopError.message : "停止比赛失败");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSelectedQuestion() {
    const question = selectedQuestion;
    if (!question || competition.state === "running") {
      setError("比赛进行中不能删除题目，请先停止比赛");
      return;
    }
    const savedAnswerCount = question.progress.submitted + question.progress.drafting;
    const answerWarning = savedAnswerCount > 0
      ? `该题已有 ${savedAnswerCount} 份已保存或已提交答卷，也会一并永久删除。`
      : "";
    if (!window.confirm(`确认删除题目《${question.title}》？${answerWarning}此操作无法恢复。`)) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<DeleteQuestionResponse>(
        `/api/competition/judge/questions/${question.id}`,
        { method: "DELETE" },
      );
      setQuestions(result.questions);
      setCompetition(result.competition);
      setAnswers([]);
      setSelectedContestantId(null);

      const nextQuestion = result.questions[0] ?? null;
      if (nextQuestion) {
        setSelectedId(nextQuestion.id);
        setTitle(nextQuestion.title);
        setContentHtml(nextQuestion.contentHtml);
        editorVersionRef.current = nextQuestion.version;
        if (nextQuestion.status === "draft") {
          window.history.replaceState(null, "", adminJudgeViewPaths.questions);
        } else {
          void loadAnswers(nextQuestion.id).catch((loadError) => {
            setError(loadError instanceof Error ? loadError.message : "下一题答卷读取失败");
          });
        }
      } else {
        setSelectedId("new");
        setTitle("");
        setContentHtml("");
        editorVersionRef.current = null;
        window.history.replaceState(null, "", adminJudgeViewPaths.dashboard);
      }
      setNotice(`题目《${result.deleted.title}》已删除${result.deleted.answerCount > 0 ? `，同时删除 ${result.deleted.answerCount} 份答卷` : ""}`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除题目失败");
    } finally {
      setSaving(false);
    }
  }

  function selectQuestion(question: JudgeQuestion) {
    setTitle(question.title);
    setContentHtml(question.contentHtml);
    editorVersionRef.current = question.version;
    setSelectedId(question.id);
    window.history.pushState(
      null,
      "",
      questionManagementEnabled || question.status === "draft"
        ? adminJudgeViewPaths.questions
        : adminJudgeViewPaths.answers,
    );
    if (!questionManagementEnabled && question.status !== "draft") {
      void loadAnswers(question.id).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "答题进度读取失败"));
    } else {
      setAnswers([]);
      setSelectedContestantId(null);
    }
  }

  function navigateView(nextView: AdminJudgeView) {
    if (nextView === view) return;
    window.history.pushState(null, "", adminJudgeViewPaths[nextView]);
    if (nextView === "answers" && typeof selectedId === "number") {
      void loadAnswers(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "答题进度读取失败"));
    }
  }

  function createQuestion() {
    if (!questionManagementEnabled) {
      setError("比赛进行中不能新增题目，请先停止比赛");
      return;
    }
    setTitle("");
    setContentHtml("");
    setAnswers([]);
    setSelectedContestantId(null);
    setSelectedId("new");
    editorVersionRef.current = null;
    window.history.pushState(null, "", adminJudgeViewPaths.questions);
  }

  return (
    <main className={`judge-workspace admin-judge-workspace ${view === "dashboard" ? "dashboard-view" : ""}`}>
        <aside className="question-queue">
          <div className="queue-heading">
            <span><small>考核题目</small><strong>{questions.length} 道</strong></span>
            <button type="button" className="square-action" disabled={!questionManagementEnabled} title={questionManagementEnabled ? "新建题目" : "比赛进行中不能新建题目"} onClick={createQuestion}><FilePlus2 />新建题目</button>
          </div>
          <div className="question-list">
            {questions.map((question) => (
              <button
                type="button"
                key={question.id}
                className={`question-list-item ${selectedId === question.id ? "active" : ""}`}
                onClick={() => selectQuestion(question)}
              >
                <span className={`question-status ${question.status === "draft" ? "draft" : competition.state}`} />
                <span>
                  <strong>{question.title}</strong>
                  <small>{questionQueueStatusLabel(question.status, competition.state)} · {formatCompetitionTime(question.publishedAt ?? question.createdAt)}</small>
                  <QuestionProgress question={question} />
                </span>
              </button>
            ))}
            {questions.length === 0 && !loading && <div className="queue-empty"><FileEdit /><span>还没有考核题目</span></div>}
          </div>
        </aside>

        <section className="judge-main">
          {view !== "dashboard" && (
            <div className="judge-toolbar">
              <div className="view-tabs" role="tablist" aria-label="题目管理视图">
                <button type="button" role="tab" aria-selected={view === "questions"} className={view === "questions" ? "active" : ""} onClick={() => navigateView("questions")}><FileEdit />题目内容</button>
                <button type="button" role="tab" aria-selected={view === "answers"} disabled={!selectedQuestion || selectedQuestion.status === "draft"} className={view === "answers" ? "active" : ""} onClick={() => navigateView("answers")}><UsersRound />答题进度</button>
              </div>
              <div className="judge-actions">
                {view === "questions" && questionEditable && (
                  <button type="button" className="primary-action" disabled={saving} onClick={() => void saveQuestion()}><FileEdit />保存题目</button>
                )}
                {questionManagementEnabled && typeof selectedId === "number" && (
                  <button type="button" className="secondary-action danger" disabled={saving} onClick={() => void deleteSelectedQuestion()}>
                    {saving ? <LoaderCircle className="spinning" /> : <Trash2 />}
                    {saving ? "正在删除" : "删除题目"}
                  </button>
                )}
                {view === "answers" && typeof selectedId === "number" && <button type="button" className="square-action light" disabled={saving} onClick={() => { void loadAnswers(selectedId); void loadQuestions(true); }}><RefreshCw />刷新答卷</button>}
              </div>
            </div>
          )}
          {(error || notice) && <div className={`workspace-message ${error ? "error" : "success"}`} role="status">{error ?? notice}</div>}

          {view === "dashboard" ? (
            <JudgeDashboard
              questions={questions}
              loading={loading}
              competition={competition}
              durationInput={durationInput}
              competitionPending={saving}
              onOpenQuestion={selectQuestion}
              onManageQuestions={() => navigateView("questions")}
              onCreateQuestion={createQuestion}
              onDurationChange={setDurationInput}
              onStartCompetition={() => void startCompetition()}
              onStopCompetition={() => void stopCompetition()}
              onCompetitionExpired={() => void loadQuestions(true).catch((loadError) => {
                setError(loadError instanceof Error ? loadError.message : "比赛状态刷新失败");
              })}
            />
          ) : view === "questions" ? (
            <div className="question-composer">
              <div className="composer-meta">
                <label>
                  <span className="composer-field-heading">
                    题目标题
                    <output className={questionTitleIsWithinLimit(title) ? "" : "over-limit"} aria-live="polite">
                      {questionTitleLength(title)}/{questionTitleMaxLength}
                    </output>
                  </span>
                  <input
                    maxLength={questionTitleMaxLength}
                    value={title}
                    disabled={!questionEditable}
                    onChange={(event) => setTitle(event.target.value)}
                    placeholder="输入考核题目标题"
                  />
                </label>
                {selectedQuestion && (
                  <span className={`large-status ${questionStatusTone(selectedQuestion.status, competition.state)}`}>
                    {statusLabel(selectedQuestion.status, competition.state)}
                  </span>
                )}
              </div>
              <RichTextEditor value={contentHtml} onChange={setContentHtml} purpose="question" editable={questionEditable} minHeight={430} />
              {selectedQuestion && <div className="record-timeline"><span><Clock3 />创建 {formatCompetitionTime(selectedQuestion.createdAt)}</span>{selectedQuestion.publishedAt && <span><Send />发布 {formatCompetitionTime(selectedQuestion.publishedAt)}</span>}{selectedQuestion.closedAt && <span><LockKeyhole />关闭 {formatCompetitionTime(selectedQuestion.closedAt)}</span>}</div>}
            </div>
          ) : selectedQuestion ? (
            <div className="answer-monitor">
              <div className="progress-strip">
                <ProgressCell label="参赛人数" value={progress.total} icon={<UsersRound />} />
                <ProgressCell label="已提交" value={progress.submitted} icon={<CheckCircle2 />} tone="success" />
                <ProgressCell label="草稿中" value={progress.drafting} icon={<FileEdit />} tone="warning" />
                <ProgressCell label="未开始" value={progress.total - progress.submitted - progress.drafting} icon={<Circle />} />
              </div>
              <div className="answer-split">
                <div className="contestant-answer-list">
                  {answers.map((answer) => (
                    <button type="button" key={answer.contestantId} className={selectedContestantId === answer.contestantId ? "active" : ""} onClick={() => setSelectedContestantId(answer.contestantId)}>
                      <span className={`answer-dot ${answer.status}`} />
                      <span><strong>{answer.username} · {answer.contestantName}</strong><small>{answerTimeLabel(answer)}</small></span>
                      <span className={`answer-status ${answer.status}`}>{answerStatusLabel(answer.status)}</span>
                    </button>
                  ))}
                  {answers.length === 0 && <div className="queue-empty"><UsersRound /><span>还没有选手账号</span></div>}
                </div>
                <article className="answer-preview">
                  {selectedAnswer ? (
                    <>
                      <header><div><span>{selectedAnswer.username}</span><h2>{selectedAnswer.contestantName} 的答卷</h2></div><span className={`answer-status ${selectedAnswer.status}`}>{answerStatusLabel(selectedAnswer.status)}</span></header>
                      {selectedAnswer.status === "not_started" ? <div className="answer-empty"><Circle /><strong>尚未开始作答</strong></div> : <PreviewableRichContent html={selectedAnswer.contentHtml} imageLabel="答卷图片" />}
                      <footer><span>首次保存 {formatCompetitionTime(selectedAnswer.firstSavedAt)}</span><span>最后保存 {formatCompetitionTime(selectedAnswer.updatedAt)}</span><span>最终提交 {formatCompetitionTime(selectedAnswer.submittedAt)}</span></footer>
                    </>
                  ) : <div className="answer-empty"><UsersRound /><strong>选择一名选手查看答卷</strong></div>}
                </article>
              </div>
            </div>
          ) : null}
        </section>

    </main>
  );
}

interface JudgeQuestionsResponse {
  questions: JudgeQuestion[];
  competition: CompetitionControl;
}

interface DeleteQuestionResponse extends JudgeQuestionsResponse {
  deleted: {
    id: number;
    title: string;
    answerCount: number;
  };
}

function QuestionProgress({ question }: { question: JudgeQuestion }) {
  const { total, submitted, drafting, notStarted } = question.progress;
  return (
    <span className="question-progress">
      <b>答题进度</b>
      {question.status === "draft" ? (
        <span>草稿未发布，选手看不到</span>
      ) : total === 0 ? (
        <span>暂无可作答的选手账号</span>
      ) : (
        <>
          <span className="submitted">已提交 {submitted}/{total}</span>
          <span className="drafting">草稿 {drafting}</span>
          <span>未开始 {notStarted}</span>
        </>
      )}
    </span>
  );
}

function statusLabel(
  status: CompetitionQuestion["status"],
  competitionState: CompetitionControl["state"],
): string {
  if (status === "draft") return "草稿";
  return competitionState === "running" ? "答题中" : competitionState === "ended" ? "已停止" : "待开始";
}

function questionStatusTone(
  status: CompetitionQuestion["status"],
  competitionState: CompetitionControl["state"],
): CompetitionQuestion["status"] {
  if (status === "draft" || competitionState === "not_started") return "draft";
  return competitionState === "running" ? "published" : "closed";
}

function questionQueueStatusLabel(
  questionStatus: CompetitionQuestion["status"],
  competitionState: CompetitionControl["state"],
): string {
  if (questionStatus === "draft") return "草稿";
  return competitionState === "running" ? "作答中" : competitionState === "ended" ? "已停止" : "未开始";
}

function answerStatusLabel(status: JudgeAnswerRow["status"]): string {
  return status === "not_started" ? "未开始" : status === "draft" ? "草稿" : "已提交";
}

function answerTimeLabel(answer: JudgeAnswerRow): string {
  if (answer.status === "not_started") return "尚无保存记录";
  return `${answer.status === "submitted" ? "提交" : "保存"} ${formatCompetitionTime(answer.submittedAt ?? answer.updatedAt)}`;
}

function ProgressCell({ label, value, icon, tone = "neutral" }: { label: string; value: number; icon: React.ReactNode; tone?: "neutral" | "success" | "warning" }) {
  return <div className={`progress-cell ${tone}`}><span>{icon}{label}</span><strong>{value}</strong></div>;
}
