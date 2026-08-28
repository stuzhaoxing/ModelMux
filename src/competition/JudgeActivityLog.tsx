"use client";

import { useMemo, useState } from "react";

import { activityActionLabel } from "@/lib/competition/activity-log";
import type { ActivityCategory, ActivityEntry } from "@/lib/competition/types";
import { formatCompetitionClock } from "./api";

type LogFilter = "all" | "answer" | "model";

const filters: Array<{ key: LogFilter; label: string }> = [
  { key: "all", label: "全部" },
  { key: "answer", label: "答题动态" },
  { key: "model", label: "模型调用" },
];

function matchesFilter(entry: ActivityEntry, filter: LogFilter): boolean {
  if (filter === "all") return true;
  if (filter === "answer") return entry.category === "answer";
  return entry.category === "model";
}

function countFor(entries: ActivityEntry[], filter: LogFilter): number {
  return entries.filter((entry) => matchesFilter(entry, filter)).length;
}

function roleLabel(entry: ActivityEntry): string {
  return entry.actorRole === "judge" ? "考务" : "选手";
}

function subjectLine(entry: ActivityEntry): string | null {
  if (entry.questionTitle) return `题目 ${entry.questionTitle}`;
  return entry.detail;
}

const categoryTags: Record<ActivityCategory, string> = {
  auth: "登录",
  answer: "答题",
  question: "题目",
  model: "模型",
};

function categoryTag(entry: ActivityEntry): string {
  return entry.action === "competition-started" || entry.action === "competition-stopped"
    ? "比赛"
    : categoryTags[entry.category];
}

export function JudgeActivityLog({
  entries,
  total,
  online,
  loading,
  loadingOlder,
  hasOlder,
  onLoadOlder,
  collapsed,
  onToggleCollapsed,
}: {
  entries: ActivityEntry[];
  total: number;
  online: boolean;
  loading: boolean;
  loadingOlder: boolean;
  hasOlder: boolean;
  onLoadOlder: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const [filter, setFilter] = useState<LogFilter>("all");
  const visible = useMemo(
    () => entries.filter((entry) => matchesFilter(entry, filter)),
    [entries, filter],
  );

  if (collapsed) {
    return (
      <aside className="activity-log collapsed">
        <button type="button" className="activity-toggle" onClick={onToggleCollapsed}>
          展开现场日志（{total} 条）
        </button>
      </aside>
    );
  }

  return (
    <aside className="activity-log" aria-label="现场日志">
      <div className="activity-heading">
        <span>
          <small>现场日志</small>
          <strong>累计 {total} 条记录</strong>
        </span>
        <button type="button" className="activity-toggle" onClick={onToggleCollapsed}>
          收起日志
        </button>
      </div>
      <p className="activity-hint">
        {online ? "实时刷新中，最新的记录排在最上面" : "实时通道已断开，正在重连"}
        {entries.length < total && `，已载入最近 ${entries.length} 条`}
      </p>
      <div className="activity-filters" role="tablist" aria-label="日志类型筛选">
        {filters.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={filter === item.key}
            className={filter === item.key ? "active" : ""}
            onClick={() => setFilter(item.key)}
          >
            {item.label} {countFor(entries, item.key)}
          </button>
        ))}
      </div>
      <ol className="activity-list">
        {visible.map((entry) => (
          <li key={entry.id} className={`activity-row ${entry.category} ${entry.outcome}`}>
            <div className="activity-row-top">
              <time>{formatCompetitionClock(entry.at)}</time>
              <strong>{activityActionLabel(entry.action)}</strong>
              <span className="activity-tag">{categoryTag(entry)}</span>
            </div>
            <div className="activity-actor">
              {roleLabel(entry)} {entry.actorName}
              <span>（{entry.actorUsername}）</span>
            </div>
            {subjectLine(entry) && <div className="activity-subject">{subjectLine(entry)}</div>}
          </li>
        ))}
      </ol>
      {hasOlder && (
        <button
          type="button"
          className="activity-more"
          disabled={loadingOlder}
          onClick={onLoadOlder}
        >
          {loadingOlder ? "正在读取更早的记录" : "加载更早的记录"}
        </button>
      )}
      {visible.length === 0 && (
        <div className="activity-empty">
          {loading
            ? "正在读取现场日志"
            : entries.length === 0
              ? "还没有产生任何操作记录"
              : "当前筛选下没有记录"}
        </div>
      )}
    </aside>
  );
}
