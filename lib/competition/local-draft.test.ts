import { describe, expect, it } from "vitest";

import {
  clearLocalDraft,
  draftRestoreOffer,
  localDraftKey,
  parseLocalDraft,
  readLocalDraft,
  richTextLooksEmpty,
  writeLocalDraft,
  type DraftStorage,
} from "./local-draft";

function memoryStorage(initial: Record<string, string> = {}): DraftStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const offerInput = {
  serverContentHtml: "<p>服务器上的草稿</p>",
  answerStatus: "draft" as const,
  questionStatus: "published" as const,
};

describe("local answer draft cache", () => {
  it("keys drafts per contestant and question so a shared browser never crosses answers", () => {
    expect(localDraftKey(7, 12)).toBe("modelmux.answer-draft.7.12");
    expect(localDraftKey(8, 12)).not.toBe(localDraftKey(7, 12));
  });

  it("round-trips a draft through storage", () => {
    const storage = memoryStorage();
    const key = localDraftKey(1, 1);
    writeLocalDraft(storage, key, { contentHtml: "<p>本机内容</p>", savedAt: "2026-08-19T03:00:00.000Z" });
    expect(readLocalDraft(storage, key)).toEqual({
      contentHtml: "<p>本机内容</p>",
      savedAt: "2026-08-19T03:00:00.000Z",
    });
    clearLocalDraft(storage, key);
    expect(readLocalDraft(storage, key)).toBeNull();
  });

  it("ignores damaged or foreign cache entries instead of throwing", () => {
    expect(parseLocalDraft(null)).toBeNull();
    expect(parseLocalDraft("not json")).toBeNull();
    expect(parseLocalDraft(JSON.stringify({ contentHtml: 42 }))).toBeNull();
    expect(readLocalDraft(null, "any")).toBeNull();
  });

  it("survives a storage that refuses to write", () => {
    const refusing: DraftStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("quota"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(() => writeLocalDraft(refusing, "k", { contentHtml: "<p>x</p>", savedAt: "now" })).not.toThrow();
    expect(() => clearLocalDraft(refusing, "k")).not.toThrow();
    expect(readLocalDraft(refusing, "k")).toBeNull();
  });

  it("offers a restore when the cache holds content the server has not seen", () => {
    const draft = { contentHtml: "<p>本机更新的内容</p>", savedAt: "2026-08-19T03:00:00.000Z" };
    expect(draftRestoreOffer({ ...offerInput, draft })).toEqual(draft);
  });

  it("stays quiet when the cache matches the server, is empty, or the answer is closed", () => {
    const savedAt = "2026-08-19T03:00:00.000Z";
    expect(draftRestoreOffer({ ...offerInput, draft: null })).toBeNull();
    expect(draftRestoreOffer({ ...offerInput, draft: { contentHtml: offerInput.serverContentHtml, savedAt } })).toBeNull();
    expect(draftRestoreOffer({ ...offerInput, draft: { contentHtml: "<p><br></p>", savedAt } })).toBeNull();
    expect(draftRestoreOffer({ ...offerInput, draft: { contentHtml: "<p>本机</p>", savedAt }, answerStatus: "submitted" })).toBeNull();
    expect(draftRestoreOffer({ ...offerInput, draft: { contentHtml: "<p>本机</p>", savedAt }, questionStatus: "closed" })).toBeNull();
  });

  it("treats an image-only answer as real content", () => {
    expect(richTextLooksEmpty("<p><br></p>")).toBe(true);
    expect(richTextLooksEmpty("<p>&nbsp;</p>")).toBe(true);
    expect(richTextLooksEmpty('<p><img src="/api/competition/media/3" /></p>')).toBe(false);
  });
});
