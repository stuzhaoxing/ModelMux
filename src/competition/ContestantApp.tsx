"use client";

import {
  Check,
  CheckCircle2,
  CircleStop,
  Clock3,
  FileEdit,
  FileText,
  History,
  LoaderCircle,
  LockKeyhole,
  RotateCcw,
  Save,
  Send,
  TimerReset,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  contestantViewFromPath,
  contestantViewRoutes,
  type ContestantView,
} from "@/lib/competition/navigation";
import { answerSaveCoversCurrentRevision } from "@/lib/competition/answer-save";
import { eventStreamRetryDelayMs } from "@/lib/competition/event-stream";
import {
  clearLocalDraft,
  draftRestoreOffer,
  localDraftKey,
  readLocalDraft,
  writeLocalDraft,
  type DraftStorage,
  type LocalAnswerDraft,
} from "@/lib/competition/local-draft";
import type { CompetitionControl, CompetitionQuestion, ContestantAnswer, SessionUser } from "@/lib/competition/types";
import type { OperationMode } from "@/lib/gateway/operation-mode";
import { apiRequest, formatCompetitionTime } from "./api";
import { ContestantApiDocs } from "./ContestantApiDocs";
import { useOperationMode } from "./OperationModeBanner";
import { PortalFrame } from "./PortalFrame";
import { PreviewableRichContent } from "./PreviewableRichContent";
import { RichTextEditor } from "./RichTextEditor";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

type DraftRestorePrompt = { questionId: number; draft: LocalAnswerDraft };
type ContestantWorkspace = { questions: CompetitionQuestion[]; answers: ContestantAnswer[]; competition: CompetitionControl };

// 本机缓存写入编辑器每次改动，600ms 一次就够覆盖断电和误关，
// 又不会让长答案在每个按键上都做一次序列化。
const draftCacheDelayMs = 600;

function draftStorage(): DraftStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // 无痕模式下访问 localStorage 会直接抛异常，兜底能力没有就没有。
    return null;
  }
}

export default function ContestantApp({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeView = contestantViewFromPath(pathname);
  const [questions, setQuestions] = useState<CompetitionQuestion[]>([]);
  const [answers, setAnswers] = useState<ContestantAnswer[]>([]);
  const [competition, setCompetition] = useState<CompetitionControl>({ state: "not_started", durationMinutes: 90, startedAt: null, endsAt: null, stoppedAt: null });
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contentHtml, setContentHtml] = useState("");
  const [online, setOnline] = useState(false);
  const { mode, setMode } = useOperationMode();
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restorePrompt, setRestorePrompt] = useState<DraftRestorePrompt | null>(null);
  const contentRef = useRef("");
  // 编辑器的 onUpdate 回调可能拿到旧一轮渲染的 state，横幅状态另存一份 ref。
  const restorePromptRef = useRef<DraftRestorePrompt | null>(null);
  const pendingDraftRef = useRef<{ questionId: number; contentHtml: string } | null>(null);
  const draftTimerRef = useRef<number | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const submittingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);

  const selectedQuestion = questions.find((item) => item.id === selectedId) ?? null;
  const selectedAnswer = answers.find((item) => item.questionId === selectedId) ?? null;
  const locked = submitting || !selectedQuestion || selectedQuestion.status === "closed" || selectedAnswer?.status === "submitted";

  const flushDraftCache = useCallback(() => {
    if (draftTimerRef.current !== null) {
      window.clearTimeout(draftTimerRef.current);
      draftTimerRef.current = null;
    }
    const pending = pendingDraftRef.current;
    if (!pending) return;
    pendingDraftRef.current = null;
    writeLocalDraft(draftStorage(), localDraftKey(user.id, pending.questionId), {
      contentHtml: pending.contentHtml,
      savedAt: new Date().toISOString(),
    });
  }, [user.id]);

  const cacheDraft = useCallback((questionId: number, contentHtml: string) => {
    pendingDraftRef.current = { questionId, contentHtml };
    if (draftTimerRef.current !== null) window.clearTimeout(draftTimerRef.current);
    draftTimerRef.current = window.setTimeout(flushDraftCache, draftCacheDelayMs);
  }, [flushDraftCache]);

  const dropDraftCache = useCallback((questionId: number) => {
    if (pendingDraftRef.current?.questionId === questionId) pendingDraftRef.current = null;
    clearLocalDraft(draftStorage(), localDraftKey(user.id, questionId));
  }, [user.id]);

  const showRestorePrompt = useCallback((prompt: DraftRestorePrompt | null) => {
    restorePromptRef.current = prompt;
    setRestorePrompt(prompt);
  }, []);

  /** 选中某题时对一次本机缓存和服务端草稿，只有本机更新才打断选手。 */
  const offerLocalDraft = useCallback((
    question: CompetitionQuestion | null,
    answer: ContestantAnswer | null,
  ) => {
    if (!question) {
      showRestorePrompt(null);
      return;
    }
    const draft = draftRestoreOffer({
      draft: readLocalDraft(draftStorage(), localDraftKey(user.id, question.id)),
      serverContentHtml: answer?.contentHtml ?? "",
      answerStatus: answer?.status ?? "not_started",
      questionStatus: question.status,
    });
    showRestorePrompt(draft ? { questionId: question.id, draft } : null);
  }, [showRestorePrompt, user.id]);

  const loadWorkspace = useCallback(async (retainSelection = true) => {
    const result = await apiRequest<ContestantWorkspace>("/api/competition/contestant/questions");
    const currentId = selectedIdRef.current;
    const nextId = retainSelection && currentId && result.questions.some((question) => question.id === currentId)
      ? currentId
      : result.questions[0]?.id ?? null;
    setQuestions(result.questions);
    setAnswers(result.answers);
    setCompetition(result.competition);
    if (nextId !== currentId) {
      flushDraftCache();
      const nextQuestion = result.questions.find((question) => question.id === nextId) ?? null;
      const nextAnswer = result.answers.find((answer) => answer.questionId === nextId) ?? null;
      const nextHtml = nextAnswer?.contentHtml ?? "";
      setContentHtml(nextHtml);
      contentRef.current = nextHtml;
      dirtyRef.current = false;
      editRevisionRef.current += 1;
      setSaveState(nextAnswer ? "saved" : "idle");
      offerLocalDraft(nextQuestion, nextAnswer);
    }
    selectedIdRef.current = nextId;
    setSelectedId(nextId);
    return result;
  }, [flushDraftCache, offerLocalDraft]);

  useEffect(() => {
    apiRequest<ContestantWorkspace>("/api/competition/contestant/questions")
      .then((workspace) => {
        setQuestions(workspace.questions);
        setAnswers(workspace.answers);
        setCompetition(workspace.competition);
        const firstQuestion = workspace.questions[0];
        const firstAnswer = workspace.answers.find((answer) => answer.questionId === firstQuestion?.id);
        const initialHtml = firstAnswer?.contentHtml ?? "";
        selectedIdRef.current = firstQuestion?.id ?? null;
        setSelectedId(firstQuestion?.id ?? null);
        setContentHtml(initialHtml);
        contentRef.current = initialHtml;
        dirtyRef.current = false;
        editRevisionRef.current += 1;
        setSaveState(firstAnswer ? "saved" : "idle");
        offerLocalDraft(firstQuestion ?? null, firstAnswer ?? null);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "题目读取失败"))
      .finally(() => setLoading(false));
  }, [offerLocalDraft]);

  useEffect(() => {
    if (competition.state !== "running" || !competition.endsAt) return;
    const endsAt = Date.parse(competition.endsAt);
    const timer = window.setInterval(() => {
      if (endsAt > Date.now()) return;
      window.clearInterval(timer);
      void loadWorkspace(false);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [competition.endsAt, competition.state, loadWorkspace]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;
    let stopped = false;

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
      const stream = new EventSource("/api/competition/events?role=contestant");
      source = stream;
      stream.addEventListener("connected", (event) => {
        attempt = 0;
        setOnline(true);
        const data = JSON.parse((event as MessageEvent).data) as { mode?: OperationMode };
        if (data.mode) setMode(data.mode);
        void loadWorkspace(true);
      });
      stream.addEventListener("mode", (event) => {
        const data = JSON.parse((event as MessageEvent).data) as { mode: OperationMode };
        setMode(data.mode);
      });
      stream.addEventListener("question-updated", () => void loadWorkspace(true));
      stream.addEventListener("degraded", () => setOnline(false));
      stream.onopen = () => {
        attempt = 0;
        setOnline(true);
      };
      stream.onerror = () => {
        setOnline(false);
        // 连接只是断了的话浏览器会自己重连；只有它已经放弃（CLOSED）才需要我们接手。
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
    };
  }, [loadWorkspace, setMode]);

  const saveAnswer = useCallback(async (submit: boolean): Promise<boolean> => {
    if (!selectedId) return false;
    if (submit) {
      submittingRef.current = true;
      setSubmitting(true);
    }

    const previousSave = savingPromiseRef.current;
    if (previousSave) {
      const previousSucceeded = await previousSave;
      if (!submit && !dirtyRef.current) return previousSucceeded;
    }

    const questionId = selectedId;
    const requestRevision = editRevisionRef.current;
    const submittedHtml = contentRef.current;
    savingRef.current = true;
    setSaveState("saving");
    setError(null);
    const savePromise = (async () => {
      try {
        const result = await apiRequest<{ answer: ContestantAnswer }>(`/api/competition/contestant/questions/${questionId}/answer`, {
          method: "PUT",
          body: JSON.stringify({ contentHtml: submittedHtml, submit }),
        });
        setAnswers((current) => [result.answer, ...current.filter((answer) => answer.questionId !== questionId)]);
        dropDraftCache(questionId);
        if (submit) {
          setContentHtml(result.answer.contentHtml);
          contentRef.current = result.answer.contentHtml;
          dirtyRef.current = false;
          setSaveState("saved");
        } else if (answerSaveCoversCurrentRevision(requestRevision, editRevisionRef.current)) {
          dirtyRef.current = false;
          setSaveState("saved");
        } else {
          dirtyRef.current = true;
          setSaveState("dirty");
        }
        return true;
      } catch (saveError) {
        if (submit) {
          try {
            const workspace = await loadWorkspace(true);
            const persisted = workspace.answers.find((answer) => answer.questionId === questionId);
            if (persisted?.status === "submitted") {
              dropDraftCache(questionId);
              setContentHtml(persisted.contentHtml);
              contentRef.current = persisted.contentHtml;
              dirtyRef.current = false;
              setSaveState("saved");
              return true;
            }
          } catch {
            // Preserve the original submission error when reconciliation is unavailable.
          }
        }
        dirtyRef.current = true;
        setSaveState("error");
        setError(saveError instanceof Error ? saveError.message : "答案保存失败");
        return false;
      } finally {
        savingRef.current = false;
        if (submit) {
          submittingRef.current = false;
          setSubmitting(false);
        }
      }
    })();
    savingPromiseRef.current = savePromise;
    const succeeded = await savePromise;
    if (savingPromiseRef.current === savePromise) savingPromiseRef.current = null;
    return succeeded;
  }, [dropDraftCache, loadWorkspace, selectedId]);

  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      // 关页面前把还在防抖里的内容落到本机缓存，下次进来才恢复得出来。
      flushDraftCache();
      if (!dirtyRef.current && !savingRef.current && !submittingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedExit);
    return () => {
      window.removeEventListener("beforeunload", preventUnsavedExit);
      flushDraftCache();
    };
  }, [flushDraftCache]);

  function changeContent(html: string) {
    if (submittingRef.current) return;
    // 横幅还开着就直接改内容，等于选了"丢弃"：本机那份不再有机会覆盖当前编辑。
    if (restorePromptRef.current) discardLocalDraft();
    setContentHtml(html);
    const previousEmpty = !contentRef.current.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() && !/<img\b/i.test(contentRef.current);
    const nextEmpty = !html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() && !/<img\b/i.test(html);
    contentRef.current = html;
    if (previousEmpty && nextEmpty) return;
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setError(null);
    setSaveState("dirty");
    if (selectedId !== null) cacheDraft(selectedId, html);
  }

  function restoreLocalDraft() {
    const prompt = restorePromptRef.current;
    if (!prompt || prompt.questionId !== selectedId) return;
    setContentHtml(prompt.draft.contentHtml);
    contentRef.current = prompt.draft.contentHtml;
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setSaveState("dirty");
    showRestorePrompt(null);
  }

  function discardLocalDraft() {
    const prompt = restorePromptRef.current;
    if (!prompt) return;
    dropDraftCache(prompt.questionId);
    showRestorePrompt(null);
  }

  async function submitAnswer() {
    if (!window.confirm("最终提交后不能再修改答案，确认提交？")) return;
    await saveAnswer(true);
  }

  async function chooseQuestion(questionId: number) {
    if (questionId === selectedId) return;
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (dirtyRef.current && !locked && !window.confirm("当前题目有未保存的修改，切换后只留在本机缓存，回到本题时可以选择恢复。确认切换？")) return;
    flushDraftCache();
    const nextAnswer = answers.find((answer) => answer.questionId === questionId);
    const nextHtml = nextAnswer?.contentHtml ?? "";
    setContentHtml(nextHtml);
    contentRef.current = nextHtml;
    dirtyRef.current = false;
    editRevisionRef.current += 1;
    setSaveState(nextAnswer ? "saved" : "idle");
    selectedIdRef.current = questionId;
    setSelectedId(questionId);
    offerLocalDraft(questions.find((question) => question.id === questionId) ?? null, nextAnswer ?? null);
  }

  async function logout() {
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (dirtyRef.current && !locked && !window.confirm("当前答案有未保存的修改，还没有保存到服务器（本机缓存会保留），确认退出？")) return;
    flushDraftCache();
    dirtyRef.current = false;
    await apiRequest("/api/competition/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  const saveLabel = useMemo(() => {
    if (selectedAnswer?.status === "submitted") return `已提交 ${formatCompetitionTime(selectedAnswer.submittedAt)}`;
    if (submitting) return "正在最终提交";
    if (saveState === "dirty") return "有修改，未保存";
    if (saveState === "saving") return "正在保存";
    if (saveState === "error") return "保存失败";
    if (selectedAnswer?.updatedAt) return `已保存 ${formatCompetitionTime(selectedAnswer.updatedAt)}`;
    return "尚未保存草稿";
  }, [saveState, selectedAnswer, submitting]);

  async function navigateView(nextView: ContestantView) {
    if (nextView === activeView) return;
    if (activeView === "questions") {
      if (savingPromiseRef.current) await savingPromiseRef.current;
      if (dirtyRef.current && !locked && !window.confirm("当前答案有未保存的修改，离开答题页后会丢失，确认离开？")) return;
    }
    window.history.pushState(null, "", contestantViewRoutes[nextView]);
  }

  return (
    <PortalFrame role="contestant" user={user} online={online} mode={mode} onLogout={() => void logout()} activeView={activeView} onViewChange={(view) => void navigateView(view)}>
      {activeView === "api-docs" ? <ContestantApiDocs /> : !loading && competition.state !== "running" ? (
        <main className="contestant-competition-gate">
          {competition.state === "ended" ? <CircleStop /> : <TimerReset />}
          <h1>{competition.state === "ended" ? "比赛已结束" : "比赛未开始"}</h1>
          <p>{competition.state === "ended"
            ? "题目已停止开放，已保存和提交的答案会继续保留。"
            : "评委开始比赛后，题目会自动显示。"}</p>
        </main>
      ) : (
      <main className="contestant-workspace">
        <aside className="contestant-questions">
          <div className="contestant-aside-heading"><span>考核题目</span><strong>{questions.length}</strong></div>
          <div className="contestant-question-list">
            {questions.map((question, index) => {
              const answer = answers.find((item) => item.questionId === question.id);
              return (
                <button key={question.id} type="button" className={selectedId === question.id ? "active" : ""} onClick={() => void chooseQuestion(question.id)}>
                  <span className="question-index">{String(questions.length - index).padStart(2, "0")}</span>
                  <span><strong>{question.title}</strong><small>{question.status === "closed" ? "已关闭" : answer?.status === "submitted" ? "已提交" : answer ? "草稿已保存" : "等待作答"}</small></span>
                  {answer?.status === "submitted" ? <CheckCircle2 className="submitted-icon" /> : question.status === "closed" ? <LockKeyhole /> : <FileText />}
                </button>
              );
            })}
            {questions.length === 0 && !loading && <div className="contestant-empty"><FileText /><strong>等待评委发布题目</strong><span>新题目发布后会实时显示</span></div>}
          </div>
        </aside>

        <section className="contestant-main">
          {selectedQuestion ? (
            <>
              <aside className="exam-material-notice" role="note" aria-labelledby="exam-material-notice-title">
                <TriangleAlert aria-hidden="true" />
                <div>
                  <strong id="exam-material-notice-title">特别提示</strong>
                  <ol>
                    <li>本考试所提供材料中涉及弄虚作假的案例，均为本次考核需要而人工编撰的虚构素材，不反映任何真实情况。</li>
                    <li>本材料仅限本次考试内部使用，严禁复制、传播或挪作他用，违者将追究相应责任。</li>
                    <li>质量核查范围仅以所提供的材料为依据，对于材料之外的内容（如监测指标是否在CMA能力项范围内、人员是否持证上岗、仪器是否检定校准等）默认视为完整且正确无误，无需核查。</li>
                  </ol>
                </div>
              </aside>

              <article className="question-paper">
                <header>
                  <div><span>考核题目 · {selectedQuestion.status === "published" ? "答题中" : "已关闭"}</span><h1>{selectedQuestion.title}</h1></div>
                  <time><Clock3 />发布于 {formatCompetitionTime(selectedQuestion.publishedAt)}</time>
                </header>
                <PreviewableRichContent html={selectedQuestion.contentHtml} className="question-content" />
              </article>

              <section className="answer-editor-panel">
                <header className="answer-heading">
                  <div><span>我的回答</span><strong className={`save-indicator ${saveState}`}>{saveState === "saving" ? <LoaderCircle className="spinning" /> : saveState === "saved" || selectedAnswer?.status === "submitted" ? <Check /> : <FileEdit />}{saveLabel}</strong></div>
                  <div>
                    {!locked && <button type="button" className="secondary-action" disabled={saveState === "saving"} onClick={() => void saveAnswer(false)}><Save />保存草稿</button>}
                    {!locked && <button type="button" className="primary-action" disabled={saveState === "saving"} onClick={() => void submitAnswer()}><Send />最终提交</button>}
                  </div>
                </header>
                {error && <div className="workspace-message error" role="alert">{error}</div>}
                {restorePrompt && restorePrompt.questionId === selectedId && !locked && (
                  <div className="draft-restore-banner" role="status">
                    <History />
                    <div className="draft-restore-text">
                      <strong>本机存有一份未保存的答案</strong>
                      <span>缓存于 {formatCompetitionTime(restorePrompt.draft.savedAt)}，与服务器上的草稿不同。恢复后仍需自己点“保存草稿”或“最终提交”。</span>
                    </div>
                    <div className="draft-restore-actions">
                      <button type="button" className="secondary-action" onClick={discardLocalDraft}><Trash2 />丢弃</button>
                      <button type="button" className="primary-action" onClick={restoreLocalDraft}><RotateCcw />恢复</button>
                    </div>
                  </div>
                )}
                {locked && <div className="locked-banner"><LockKeyhole />{submitting ? "正在最终提交，请等待服务器确认" : selectedAnswer?.status === "submitted" ? "答案已最终提交，内容已锁定" : "题目已关闭，不能继续修改答案"}</div>}
                <RichTextEditor value={contentHtml} onChange={changeContent} purpose="answer" editable={!locked} minHeight={350} />
              </section>
            </>
          ) : (
            <div className="waiting-stage"><div className="waiting-line" /><FileText /><h1>等待考核题目</h1><p>评委发布后，题目会自动出现在左侧列表。</p></div>
          )}
        </section>
      </main>
      )}
    </PortalFrame>
  );
}
