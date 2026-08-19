"use client";

import {
  CheckCircle2,
  Circle,
  Clock3,
  FileEdit,
  FilePlus2,
  Gavel,
  LockKeyhole,
  RefreshCw,
  Send,
  UsersRound,
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  judgeViewFromPath,
  judgeViewRoutes,
  type JudgeView,
} from "@/lib/competition/navigation";
import type { ActivityEntry, CompetitionQuestion, JudgeAnswerRow, JudgeQuestion, SessionUser } from "@/lib/competition/types";
import type { OperationMode } from "@/lib/gateway/operation-mode";
import { apiRequest, formatCompetitionTime } from "./api";
import { JudgeActivityLog } from "./JudgeActivityLog";
import { useOperationMode } from "./OperationModeBanner";
import { PortalFrame } from "./PortalFrame";
import { RichTextEditor } from "./RichTextEditor";

export default function JudgeApp({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const view = judgeViewFromPath(pathname);
  const initialViewRef = useRef(view);
  const editorVersionRef = useRef<number | null>(null);
  const answersRequestRef = useRef(0);
  const answerRefreshTimerRef = useRef<number | null>(null);
  const queueRefreshTimerRef = useRef<number | null>(null);
  const [questions, setQuestions] = useState<JudgeQuestion[]>([]);
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [answers, setAnswers] = useState<JudgeAnswerRow[]>([]);
  const [selectedContestantId, setSelectedContestantId] = useState<number | null>(null);
  const [online, setOnline] = useState(false);
  const { mode, setMode } = useOperationMode();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [contentHtml, setContentHtml] = useState("");
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityLoading, setActivityLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedLogStart, setReachedLogStart] = useState(false);
  const [logCollapsed, setLogCollapsed] = useState(false);

  const selectedQuestion = selectedId === "new" ? null : questions.find((item) => item.id === selectedId) ?? null;
  const selectedAnswer = answers.find((item) => item.contestantId === selectedContestantId) ?? null;
  const questionEditable = selectedId === "new" || selectedQuestion?.status === "draft";

  const loadQuestions = useCallback(async (retainSelection = true) => {
    const result = await apiRequest<{ questions: JudgeQuestion[] }>("/api/competition/judge/questions");
    setQuestions(result.questions);
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

  const mergeActivity = useCallback((incoming: ActivityEntry[]) => {
    if (incoming.length === 0) return;
    setActivity((current) => {
      const seen = new Set(current.map((entry) => entry.id));
      const merged = [...current, ...incoming.filter((entry) => !seen.has(entry.id))];
      merged.sort((left, right) => right.id - left.id);
      return merged;
    });
  }, []);

  const loadActivity = useCallback(async () => {
    try {
      const result = await apiRequest<ActivityPage>("/api/competition/judge/activity");
      mergeActivity(result.activity);
      setActivityTotal(result.total);
    } finally {
      setActivityLoading(false);
    }
  }, [mergeActivity]);

  const loadOlderActivity = useCallback(async () => {
    const oldest = activity.at(-1);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await apiRequest<ActivityPage>(`/api/competition/judge/activity?before=${oldest.id}`);
      mergeActivity(result.activity);
      setActivityTotal(result.total);
      if (result.reachedStart) setReachedLogStart(true);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "现场日志读取失败");
    } finally {
      setLoadingOlder(false);
    }
  }, [activity, loadingOlder, mergeActivity]);

  useEffect(() => {
    apiRequest<{ questions: JudgeQuestion[] }>("/api/competition/judge/questions")
      .then(async (workspace) => {
        setQuestions(workspace.questions);
        const requestedFirst = initialViewRef.current === "answers"
          ? workspace.questions.find((question) => question.status !== "draft")
          : workspace.questions[0];
        const first = requestedFirst ?? workspace.questions[0];
        if (initialViewRef.current === "answers" && !requestedFirst) {
          window.history.replaceState(null, "", judgeViewRoutes.questions);
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
    void loadActivity().catch(() => setActivityLoading(false));
  }, [loadActivity]);

  useEffect(() => {
    const source = new EventSource("/api/competition/events?role=judge");
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
    source.addEventListener("connected", (event) => {
      setOnline(true);
      const data = JSON.parse((event as MessageEvent).data) as { mode?: OperationMode };
      if (data.mode) setMode(data.mode);
      void loadQuestions(true);
      if (typeof selectedId === "number") scheduleAnswerReload(selectedId);
    });
    source.addEventListener("mode", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { mode: OperationMode };
      setMode(data.mode);
    });
    source.addEventListener("activity", (event) => {
      const entries = JSON.parse((event as MessageEvent).data) as ActivityEntry[];
      mergeActivity(entries);
      setActivityTotal((current) => current + entries.length);
    });
    source.addEventListener("question-updated", () => void loadQuestions(true));
    source.addEventListener("answer-updated", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { questionId: number };
      scheduleQueueReload();
      if (typeof selectedId === "number" && data.questionId === selectedId) scheduleAnswerReload(selectedId);
    });
    source.addEventListener("degraded", () => setOnline(false));
    source.onerror = () => setOnline(false);
    source.onopen = () => setOnline(true);
    return () => {
      source.close();
      if (answerRefreshTimerRef.current !== null) window.clearTimeout(answerRefreshTimerRef.current);
      answerRefreshTimerRef.current = null;
      if (queueRefreshTimerRef.current !== null) window.clearTimeout(queueRefreshTimerRef.current);
      queueRefreshTimerRef.current = null;
    };
  }, [loadAnswers, loadQuestions, mergeActivity, selectedId, setMode]);

  const progress = useMemo(() => ({
    total: answers.length,
    submitted: answers.filter((answer) => answer.status === "submitted").length,
    drafting: answers.filter((answer) => answer.status === "draft").length,
  }), [answers]);

  async function saveQuestion(publish: boolean) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (selectedId === "new") {
        const result = await apiRequest<{ id: number; question: CompetitionQuestion }>("/api/competition/judge/questions", {
          method: "POST",
          body: JSON.stringify({ title, contentHtml, publish }),
        });
        await loadQuestions(false);
        setSelectedId(result.id);
        setTitle(result.question.title);
        setContentHtml(result.question.contentHtml);
        editorVersionRef.current = result.question.version;
      } else if (selectedQuestion?.status === "draft") {
        const result = await apiRequest<{ question: CompetitionQuestion }>(`/api/competition/judge/questions/${selectedQuestion.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            action: publish ? "publish" : "update",
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
      setNotice(publish ? "题目已发布" : "题目已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "题目保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function closeCurrentQuestion() {
    if (!selectedQuestion || !window.confirm("关闭后选手将不能继续修改或提交，确认关闭这道题目？")) return;
    setSaving(true);
    try {
      const result = await apiRequest<{ question: CompetitionQuestion }>(`/api/competition/judge/questions/${selectedQuestion.id}`, { method: "PATCH", body: JSON.stringify({ action: "close" }) });
      editorVersionRef.current = result.question.version;
      await loadQuestions(true);
      setNotice("题目已关闭");
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : "题目关闭失败");
    } finally {
      setSaving(false);
    }
  }

  async function logout() {
    await apiRequest("/api/competition/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  function selectQuestion(question: JudgeQuestion) {
    setTitle(question.title);
    setContentHtml(question.contentHtml);
    editorVersionRef.current = question.version;
    setSelectedId(question.id);
    window.history.pushState(
      null,
      "",
      question.status === "draft"
        ? judgeViewRoutes.questions
        : judgeViewRoutes.answers,
    );
    if (question.status !== "draft") {
      void loadAnswers(question.id).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "答题进度读取失败"));
    } else {
      setAnswers([]);
      setSelectedContestantId(null);
    }
  }

  function navigateView(nextView: JudgeView) {
    if (nextView === view) return;
    window.history.pushState(null, "", judgeViewRoutes[nextView]);
    if (nextView === "answers" && typeof selectedId === "number") {
      void loadAnswers(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "答题进度读取失败"));
    }
  }

  function createQuestion() {
    setTitle("");
    setContentHtml("");
    setAnswers([]);
    setSelectedContestantId(null);
    setSelectedId("new");
    editorVersionRef.current = null;
    window.history.pushState(null, "", judgeViewRoutes.questions);
  }

  return (
    <PortalFrame role="judge" user={user} online={online} mode={mode} onLogout={() => void logout()}>
      <main className={`judge-workspace ${logCollapsed ? "log-collapsed" : ""}`}>
        <aside className="question-queue">
          <div className="queue-heading">
            <span><small>考核题目</small><strong>{questions.length} 道</strong></span>
            <button type="button" className="square-action" onClick={createQuestion}><FilePlus2 />新建题目</button>
          </div>
          <div className="question-list">
            {questions.map((question) => (
              <button
                type="button"
                key={question.id}
                className={`question-list-item ${selectedId === question.id ? "active" : ""}`}
                onClick={() => selectQuestion(question)}
              >
                <span className={`question-status ${question.status}`} />
                <span>
                  <strong>{question.title}</strong>
                  <small>{statusLabel(question.status)} · {formatCompetitionTime(question.publishedAt ?? question.createdAt)}</small>
                  <QuestionProgress question={question} />
                </span>
              </button>
            ))}
            {questions.length === 0 && !loading && <div className="queue-empty"><FileEdit /><span>还没有考核题目</span></div>}
          </div>
        </aside>

        <section className="judge-main">
          <div className="judge-toolbar">
            <div className="view-tabs" role="tablist">
              <button type="button" className={view === "questions" ? "active" : ""} onClick={() => navigateView("questions")}><Gavel />题目内容</button>
              <button type="button" disabled={!selectedQuestion || selectedQuestion.status === "draft"} className={view === "answers" ? "active" : ""} onClick={() => navigateView("answers")}><UsersRound />答题进度</button>
            </div>
            <div className="judge-actions">
              {selectedQuestion?.status === "published" && <button type="button" className="secondary-action danger" disabled={saving} onClick={() => void closeCurrentQuestion()}><LockKeyhole />关闭题目</button>}
              {view === "questions" && questionEditable && (
                <>
                  <button type="button" className="secondary-action" disabled={saving} onClick={() => void saveQuestion(false)}><FileEdit />保存</button>
                  {(selectedId === "new" || selectedQuestion?.status === "draft") && <button type="button" className="primary-action" disabled={saving} onClick={() => void saveQuestion(true)}><Send />发布题目</button>}
                </>
              )}
              {view === "answers" && typeof selectedId === "number" && <button type="button" className="square-action light" onClick={() => { void loadAnswers(selectedId); void loadQuestions(true); }}><RefreshCw />刷新答卷</button>}
            </div>
          </div>
          {(error || notice) && <div className={`workspace-message ${error ? "error" : "success"}`} role="status">{error ?? notice}</div>}

          {view === "questions" ? (
            <div className="question-composer">
              <div className="composer-meta">
                <label>题目标题<input maxLength={200} value={title} disabled={!questionEditable} onChange={(event) => setTitle(event.target.value)} placeholder="输入考核题目标题" /></label>
                {selectedQuestion && <span className={`large-status ${selectedQuestion.status}`}>{statusLabel(selectedQuestion.status)}</span>}
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
                      {selectedAnswer.status === "not_started" ? <div className="answer-empty"><Circle /><strong>尚未开始作答</strong></div> : <div className="rich-content" dangerouslySetInnerHTML={{ __html: selectedAnswer.contentHtml }} />}
                      <footer><span>首次保存 {formatCompetitionTime(selectedAnswer.firstSavedAt)}</span><span>最后保存 {formatCompetitionTime(selectedAnswer.updatedAt)}</span><span>最终提交 {formatCompetitionTime(selectedAnswer.submittedAt)}</span></footer>
                    </>
                  ) : <div className="answer-empty"><UsersRound /><strong>选择一名选手查看答卷</strong></div>}
                </article>
              </div>
            </div>
          ) : null}
        </section>

        <JudgeActivityLog
          entries={activity}
          total={activityTotal}
          online={online}
          loading={activityLoading}
          loadingOlder={loadingOlder}
          hasOlder={!reachedLogStart && activity.length < activityTotal}
          onLoadOlder={() => void loadOlderActivity()}
          collapsed={logCollapsed}
          onToggleCollapsed={() => setLogCollapsed((current) => !current)}
        />
      </main>
    </PortalFrame>
  );
}

interface ActivityPage {
  activity: ActivityEntry[];
  total: number;
  reachedStart: boolean;
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

function statusLabel(status: CompetitionQuestion["status"]): string {
  return status === "draft" ? "草稿" : status === "published" ? "答题中" : "已关闭";
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
