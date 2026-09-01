"use client";

import { LoaderCircle, MonitorUp, Save } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  CompetitionControlState,
  CompetitionScreenNotice,
} from "@/lib/competition/types";
import { apiRequest } from "./api";

const defaultNotice: CompetitionScreenNotice = {
  title: "赛前提醒",
  content: "",
  enabled: false,
  updatedAt: null,
};

export function ScreenNoticeEditor({
  competitionState,
}: {
  competitionState: CompetitionControlState;
}) {
  const [notice, setNotice] = useState(defaultNotice);
  const [savedNotice, setSavedNotice] = useState(defaultNotice);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function updateDraft(patch: Partial<Pick<CompetitionScreenNotice, "title" | "content" | "enabled">>) {
    setNotice((current) => ({ ...current, ...patch }));
    setMessage(null);
    setError(null);
  }

  useEffect(() => {
    apiRequest<{ notice: CompetitionScreenNotice }>("/api/competition/judge/screen-notice")
      .then((result) => {
        setNotice(result.notice);
        setSavedNotice(result.notice);
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "公告读取失败"))
      .finally(() => setLoading(false));
  }, []);

  async function saveNotice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading) return;
    if (notice.enabled && !notice.content.trim()) {
      setError("展示公告前请先填写正文");
      return;
    }
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const result = await apiRequest<{ notice: CompetitionScreenNotice }>(
        "/api/competition/judge/screen-notice",
        {
          method: "PATCH",
          body: JSON.stringify({
            title: notice.title,
            content: notice.content,
            enabled: notice.enabled,
          }),
        },
      );
      setNotice(result.notice);
      setSavedNotice(result.notice);
      setMessage(result.notice.enabled ? "赛前公告已保存并开启" : "赛前公告已保存，当前关闭");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "公告保存失败");
    } finally {
      setSaving(false);
    }
  }

  const visibleNow = savedNotice.enabled && competitionState === "not_started";
  const displayStatus = !savedNotice.enabled
    ? "未开启"
    : visibleNow
      ? "大屏展示中"
      : competitionState === "running"
        ? "比赛中不展示"
        : "当前状态不展示";
  const dirty = notice.title !== savedNotice.title
    || notice.content !== savedNotice.content
    || notice.enabled !== savedNotice.enabled;

  return (
    <section className="dashboard-screen-notice" aria-labelledby="screen-notice-heading">
      <header>
        <span className="dashboard-screen-notice-icon"><MonitorUp /></span>
        <div>
          <span>PUBLIC SCREEN</span>
          <h2 id="screen-notice-heading">赛前大屏公告</h2>
        </div>
        <strong data-visible={visibleNow}>
          {displayStatus}
        </strong>
      </header>

      <form onSubmit={(event) => void saveNotice(event)}>
        <label>
          <span>公告标题 <small>{notice.title.length}/40</small></span>
          <input
            type="text"
            maxLength={40}
            value={notice.title}
            disabled={loading || saving}
            onChange={(event) => updateDraft({ title: event.target.value })}
          />
        </label>
        <label className="dashboard-screen-notice-content">
          <span>公告正文 <small>{notice.content.length}/300</small></span>
          <textarea
            maxLength={300}
            rows={5}
            value={notice.content}
            disabled={loading || saving}
            placeholder={"API Base URL\nhttp://192.168.1.10:1444/v1"}
            onChange={(event) => updateDraft({ content: event.target.value })}
          />
        </label>
        <footer>
          <label className="dashboard-screen-notice-toggle">
            <input
              type="checkbox"
              checked={notice.enabled}
              disabled={loading || saving}
              onChange={(event) => updateDraft({ enabled: event.target.checked })}
            />
            <span aria-hidden><i /></span>
            <strong>比赛未开始时展示</strong>
          </label>
          <output className={error ? "error" : ""} aria-live="polite">{error ?? message ?? (dirty ? "有未保存修改" : null)}</output>
          <button className="primary-action" type="submit" disabled={loading || saving || !dirty || !notice.title.trim()}>
            {loading || saving ? <LoaderCircle className="spinning" /> : <Save />}
            {loading ? "正在读取" : saving ? "正在保存" : "保存公告"}
          </button>
        </footer>
      </form>
    </section>
  );
}
