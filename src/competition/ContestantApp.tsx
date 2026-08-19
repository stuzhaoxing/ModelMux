"use client";

import {
  Check,
  CheckCircle2,
  Clock3,
  FileEdit,
  FileText,
  LoaderCircle,
  LockKeyhole,
  Save,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import {
  contestantViewFromPath,
  contestantViewRoutes,
  type ContestantView,
} from "@/lib/competition/navigation";
import { answerSaveCoversCurrentRevision } from "@/lib/competition/answer-save";
import type { CompetitionQuestion, ContestantAnswer, SessionUser } from "@/lib/competition/types";
import type { OperationMode } from "@/lib/gateway/operation-mode";
import { apiRequest, formatCompetitionTime } from "./api";
import { ContestantApiDocs } from "./ContestantApiDocs";
import { useOperationMode } from "./OperationModeBanner";
import { PortalFrame } from "./PortalFrame";
import { RichTextEditor } from "./RichTextEditor";

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

export default function ContestantApp({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const router = useRouter();
  const activeView = contestantViewFromPath(pathname);
  const [questions, setQuestions] = useState<CompetitionQuestion[]>([]);
  const [answers, setAnswers] = useState<ContestantAnswer[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [contentHtml, setContentHtml] = useState("");
  const [online, setOnline] = useState(false);
  const { mode, setMode } = useOperationMode();
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef("");
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const submittingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const savingPromiseRef = useRef<Promise<boolean> | null>(null);

  const selectedQuestion = questions.find((item) => item.id === selectedId) ?? null;
  const selectedAnswer = answers.find((item) => item.questionId === selectedId) ?? null;
  const locked = submitting || !selectedQuestion || selectedQuestion.status === "closed" || selectedAnswer?.status === "submitted";

  const loadWorkspace = useCallback(async (retainSelection = true) => {
    const result = await apiRequest<{ questions: CompetitionQuestion[]; answers: ContestantAnswer[] }>("/api/competition/contestant/questions");
    setQuestions(result.questions);
    setAnswers(result.answers);
    setSelectedId((current) => retainSelection && current && result.questions.some((question) => question.id === current) ? current : result.questions[0]?.id ?? null);
    return result;
  }, []);

  useEffect(() => {
    apiRequest<{ questions: CompetitionQuestion[]; answers: ContestantAnswer[] }>("/api/competition/contestant/questions")
      .then((workspace) => {
        setQuestions(workspace.questions);
        setAnswers(workspace.answers);
        const firstQuestion = workspace.questions[0];
        const firstAnswer = workspace.answers.find((answer) => answer.questionId === firstQuestion?.id);
        const initialHtml = firstAnswer?.contentHtml ?? "";
        setSelectedId(firstQuestion?.id ?? null);
        setContentHtml(initialHtml);
        contentRef.current = initialHtml;
        dirtyRef.current = false;
        editRevisionRef.current += 1;
        setSaveState(firstAnswer ? "saved" : "idle");
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "题目读取失败"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const source = new EventSource("/api/competition/events?role=contestant");
    source.addEventListener("connected", (event) => {
      setOnline(true);
      const data = JSON.parse((event as MessageEvent).data) as { mode?: OperationMode };
      if (data.mode) setMode(data.mode);
      void loadWorkspace(true);
    });
    source.addEventListener("mode", (event) => {
      const data = JSON.parse((event as MessageEvent).data) as { mode: OperationMode };
      setMode(data.mode);
    });
    source.addEventListener("question-updated", () => void loadWorkspace(true));
    source.addEventListener("degraded", () => setOnline(false));
    source.onerror = () => setOnline(false);
    source.onopen = () => setOnline(true);
    return () => source.close();
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
  }, [loadWorkspace, selectedId]);

  useEffect(() => {
    const preventUnsavedExit = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current && !submittingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", preventUnsavedExit);
    return () => window.removeEventListener("beforeunload", preventUnsavedExit);
  }, []);

  function changeContent(html: string) {
    if (submittingRef.current) return;
    setContentHtml(html);
    const previousEmpty = !contentRef.current.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() && !/<img\b/i.test(contentRef.current);
    const nextEmpty = !html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() && !/<img\b/i.test(html);
    contentRef.current = html;
    if (previousEmpty && nextEmpty) return;
    editRevisionRef.current += 1;
    dirtyRef.current = true;
    setError(null);
    setSaveState("dirty");
  }

  async function submitAnswer() {
    if (!window.confirm("最终提交后不能再修改答案，确认提交？")) return;
    await saveAnswer(true);
  }

  async function chooseQuestion(questionId: number) {
    if (questionId === selectedId) return;
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (dirtyRef.current && !locked && !window.confirm("当前题目有未保存的修改，切换题目后会丢失，确认切换？")) return;
    const nextAnswer = answers.find((answer) => answer.questionId === questionId);
    const nextHtml = nextAnswer?.contentHtml ?? "";
    setContentHtml(nextHtml);
    contentRef.current = nextHtml;
    dirtyRef.current = false;
    editRevisionRef.current += 1;
    setSaveState(nextAnswer ? "saved" : "idle");
    setSelectedId(questionId);
  }

  async function logout() {
    if (savingPromiseRef.current) await savingPromiseRef.current;
    if (dirtyRef.current && !locked && !window.confirm("当前答案有未保存的修改，退出登录后会丢失，确认退出？")) return;
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
      {activeView === "api-docs" ? <ContestantApiDocs /> : (
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
              <article className="question-paper">
                <header>
                  <div><span>考核题目 · {selectedQuestion.status === "published" ? "答题中" : "已关闭"}</span><h1>{selectedQuestion.title}</h1></div>
                  <time><Clock3 />发布于 {formatCompetitionTime(selectedQuestion.publishedAt)}</time>
                </header>
                <div className="rich-content question-content" dangerouslySetInnerHTML={{ __html: selectedQuestion.contentHtml }} />
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
