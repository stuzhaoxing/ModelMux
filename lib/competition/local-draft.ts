import type { AnswerStatus, QuestionStatus } from "./types";

export interface LocalAnswerDraft {
  contentHtml: string;
  savedAt: string;
}

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const draftKeyPrefix = "modelmux.answer-draft";

export function localDraftKey(contestantId: number, questionId: number): string {
  return `${draftKeyPrefix}.${contestantId}.${questionId}`;
}

/**
 * 编辑器里只有空标签也算空。和服务端的 richTextHasContent 判定一致，
 * 但不引入 sanitize-html，避免把它打进选手端的浏览器包。
 */
export function richTextLooksEmpty(html: string): boolean {
  const text = html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
  return text.length === 0 && !/<img\b/i.test(html);
}

export function parseLocalDraft(raw: string | null): LocalAnswerDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const { contentHtml, savedAt } = parsed as Partial<LocalAnswerDraft>;
    if (typeof contentHtml !== "string" || typeof savedAt !== "string") return null;
    return { contentHtml, savedAt };
  } catch {
    return null;
  }
}

export function readLocalDraft(storage: DraftStorage | null, key: string): LocalAnswerDraft | null {
  if (!storage) return null;
  try {
    return parseLocalDraft(storage.getItem(key));
  } catch {
    return null;
  }
}

/**
 * 本地缓存只是断电和误关页面的兜底，写不进去（无痕模式、配额写满）
 * 也不能影响正常答题，所以所有失败都吞掉。
 */
export function writeLocalDraft(storage: DraftStorage | null, key: string, draft: LocalAnswerDraft): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // 忽略：缓存失败时仍可正常保存草稿到服务器
  }
}

export function clearLocalDraft(storage: DraftStorage | null, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // 忽略：缓存清理失败不影响答题
  }
}

/**
 * 只有"本机缓存里有服务端没有的内容"才值得打断选手。已提交、题目已关闭
 * 或缓存和服务端一致时都不弹横幅，避免每次刷新都要选一次。
 */
export function draftRestoreOffer(input: {
  draft: LocalAnswerDraft | null;
  serverContentHtml: string;
  answerStatus: AnswerStatus;
  questionStatus: QuestionStatus;
}): LocalAnswerDraft | null {
  const { draft } = input;
  if (!draft) return null;
  if (input.answerStatus === "submitted") return null;
  if (input.questionStatus !== "published") return null;
  if (draft.contentHtml === input.serverContentHtml) return null;
  if (richTextLooksEmpty(draft.contentHtml)) return null;
  return draft;
}
