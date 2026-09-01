"use client";

import { useCallback, useEffect, useState } from "react";

import { eventStreamRetryDelayMs } from "@/lib/competition/event-stream";
import type { ActivityEntry } from "@/lib/competition/types";
import { apiRequest } from "./api";
import { JudgeActivityLog } from "./JudgeActivityLog";

interface ActivityPage {
  activity: ActivityEntry[];
  total: number;
  reachedStart: boolean;
}

export default function JudgeActivityPage() {
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [online, setOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reachedStart, setReachedStart] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      setTotal(result.total);
      setReachedStart(result.reachedStart);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "现场日志读取失败");
    } finally {
      setLoading(false);
    }
  }, [mergeActivity]);

  const loadOlderActivity = useCallback(async () => {
    const oldest = activity.at(-1);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await apiRequest<ActivityPage>(`/api/competition/judge/activity?before=${oldest.id}`);
      mergeActivity(result.activity);
      setTotal(result.total);
      if (result.reachedStart) setReachedStart(true);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "现场日志读取失败");
    } finally {
      setLoadingOlder(false);
    }
  }, [activity, loadingOlder, mergeActivity]);

  useEffect(() => {
    let active = true;
    apiRequest<ActivityPage>("/api/competition/judge/activity")
      .then((result) => {
        if (!active) return;
        mergeActivity(result.activity);
        setTotal(result.total);
        setReachedStart(result.reachedStart);
        setError(null);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : "现场日志读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mergeActivity]);

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: number | null = null;
    let attempt = 0;
    let stopped = false;
    let connectedOnce = false;

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
      stream.addEventListener("connected", () => {
        attempt = 0;
        setOnline(true);
        if (connectedOnce) void loadActivity();
        connectedOnce = true;
      });
      stream.addEventListener("activity", (event) => {
        const entries = JSON.parse((event as MessageEvent).data) as ActivityEntry[];
        mergeActivity(entries);
        setTotal((current) => current + entries.length);
      });
      stream.addEventListener("degraded", () => setOnline(false));
      stream.onopen = () => {
        attempt = 0;
        setOnline(true);
      };
      stream.onerror = () => {
        setOnline(false);
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
  }, [loadActivity, mergeActivity]);

  return (
    <main className="judge-activity-page">
      {error && <div className="workspace-message error" role="alert">{error}</div>}
      <JudgeActivityLog
        entries={activity}
        total={total}
        online={online}
        loading={loading}
        loadingOlder={loadingOlder}
        hasOlder={!reachedStart && activity.length < total}
        onLoadOlder={() => void loadOlderActivity()}
      />
    </main>
  );
}
