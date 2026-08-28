"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  CheckCircle2,
  Radio,
  Users,
} from "lucide-react";

import {
  competitionScreenContestantsByPinyin,
  competitionScreenGrid,
  competitionScreenProgressChanges,
  competitionScreenProgressCount,
  competitionScreenStageAt,
  type CompetitionScreenContestant,
  type CompetitionScreenContestantStatus,
  type CompetitionScreenProgressChange,
  type CompetitionScreenSnapshot,
  type CompetitionScreenStage,
} from "@/lib/competition/screen-model";

import CompetitionScreenBackdrop from "./CompetitionScreenBackdrop";
import CompetitionScreenBrand from "./CompetitionScreenBrand";
import styles from "./CompetitionScreen.module.css";

const snapshotIntervalMs = 3_000;
const progressHighlightMs = 1_800;

const stageLabels: Record<CompetitionScreenStage, string> = {
  setup: "等待题目发布",
  scheduled: "比赛尚未开始",
  rehearsal: "测试演练中",
  live: "比赛进行中",
  finished: "比赛已结束",
};

const contestantStatusLabels: Record<CompetitionScreenContestantStatus, string> = {
  waiting: "等待题目",
  not_started: "未开始",
  drafting: "答题中",
  submitted: "已交卷",
  unfinished: "未完成",
};

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
}

function formatCountdown(target: string | null, now: number): string {
  if (!target) return "--:--:--";
  let remaining = Math.max(0, Math.floor((Date.parse(target) - now) / 1000));
  const days = Math.floor(remaining / 86_400);
  remaining -= days * 86_400;
  const hours = Math.floor(remaining / 3_600);
  remaining -= hours * 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining - minutes * 60;
  const clock = [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
  return days > 0 ? `${days}天 ${clock}` : clock;
}

function formatDuration(secondsValue: number): string {
  let remaining = Math.max(0, Math.floor(secondsValue));
  const hours = Math.floor(remaining / 3_600);
  remaining -= hours * 3_600;
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining - minutes * 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

function simulationCountdown(snapshot: CompetitionScreenSnapshot, now: number): string {
  const simulation = snapshot.simulation;
  if (!simulation) return "--:--:--";
  const remainingAtSnapshot = (simulation.totalMinutes - simulation.elapsedMinutes) * 60;
  const elapsedSinceSnapshot = Math.max(0, now - Date.parse(snapshot.generatedAt));
  const acceleratedSeconds = Math.floor((elapsedSinceSnapshot * 60) / simulation.realMsPerMinute);
  return formatDuration(remainingAtSnapshot - acceleratedSeconds);
}

function progressPercent(contestant: CompetitionScreenContestant, questionTotal: number): number {
  if (questionTotal === 0) return 0;
  return Math.min(100, (competitionScreenProgressCount(contestant, questionTotal) / questionTotal) * 100);
}

function summaryStage(snapshot: CompetitionScreenSnapshot, now: number): CompetitionScreenStage {
  return competitionScreenStageAt({
    schedule: snapshot.schedule,
    mode: snapshot.mode,
    questionTotal: snapshot.summary.questionTotal,
    publishedQuestions: snapshot.summary.publishedQuestions,
    closedQuestions: snapshot.summary.closedQuestions,
    competitionState: snapshot.competition.state,
    now,
  });
}

export default function CompetitionScreen({
  initialSnapshot,
  mockMode = false,
  mockStartedAt = null,
}: {
  initialSnapshot: CompetitionScreenSnapshot | null;
  mockMode?: boolean;
  mockStartedAt?: number | null;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [now, setNow] = useState(() => initialSnapshot ? Date.parse(initialSnapshot.generatedAt) : Date.now());
  const [recentProgressChanges, setRecentProgressChanges] = useState(
    () => new Map<number, CompetitionScreenProgressChange>(),
  );
  const progressHighlightTimers = useRef(new Map<number, number>());
  const previousSnapshot = useRef(initialSnapshot);

  const highlightProgressChanges = useCallback((changes: CompetitionScreenProgressChange[]) => {
    if (changes.length === 0) return;
    setRecentProgressChanges((current) => {
      const next = new Map(current);
      for (const change of changes) next.set(change.id, change);
      return next;
    });
    for (const change of changes) {
      const existingTimer = progressHighlightTimers.current.get(change.id);
      if (existingTimer !== undefined) window.clearTimeout(existingTimer);
      const timer = window.setTimeout(() => {
        progressHighlightTimers.current.delete(change.id);
        setRecentProgressChanges((current) => {
          if (!current.has(change.id)) return current;
          const next = new Map(current);
          next.delete(change.id);
          return next;
        });
      }, progressHighlightMs);
      progressHighlightTimers.current.set(change.id, timer);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const mockQuery = mockMode && mockStartedAt !== null
          ? `?mock=1&startedAt=${mockStartedAt}`
          : "";
        const response = await fetch(`/api/competition/screen${mockQuery}`, { cache: "no-store" });
        if (response.status === 401) {
          if (!stopped) {
            setSnapshot(null);
            window.location.reload();
          }
          return;
        }
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const next = await response.json() as CompetitionScreenSnapshot;
        if (!stopped) {
          const changes = competitionScreenProgressChanges(previousSnapshot.current, next);
          previousSnapshot.current = next;
          setSnapshot(next);
          highlightProgressChanges(changes);
        }
      } catch {
        // Keep the latest snapshot visible while the next poll retries.
      } finally {
        loading = false;
      }
    };

    void refresh();
    const interval = window.setInterval(refresh, snapshotIntervalMs);
    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [highlightProgressChanges, mockMode, mockStartedAt]);

  useEffect(() => () => {
    for (const timer of progressHighlightTimers.current.values()) window.clearTimeout(timer);
    progressHighlightTimers.current.clear();
  }, []);

  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(clock);
  }, []);

  const rankedContestants = useMemo(
    () => competitionScreenContestantsByPinyin(snapshot?.contestants ?? []),
    [snapshot?.contestants],
  );
  const screenGrid = useMemo(
    () => competitionScreenGrid(rankedContestants.length),
    [rankedContestants.length],
  );

  if (!snapshot) {
    return (
      <main className={styles.unavailable}>
        <CompetitionScreenBackdrop />
        <CompetitionScreenBrand time={formatClock(now)} />
        <span className={styles.unavailableSignal}><Radio /></span>
        <strong>正在连接比赛数据</strong>
      </main>
    );
  }

  const stage = snapshot.simulation ? snapshot.stage : summaryStage(snapshot, now);
  const countdownTarget = stage === "scheduled" ? snapshot.schedule.startAt : stage === "live" || stage === "rehearsal" ? snapshot.schedule.endAt : null;
  const countdownLabel = stage === "scheduled" ? "距离比赛开始" : stage === "rehearsal" ? "演练剩余时间" : "比赛剩余时间";
  const countdownValue = snapshot.simulation
    ? simulationCountdown(snapshot, now)
    : formatCountdown(countdownTarget, now);
  const density = screenGrid.rows >= 6 ? "dense" : screenGrid.rows >= 5 ? "compact" : "regular";
  const rosterStyle = { "--screen-columns": screenGrid.columns, "--screen-rows": screenGrid.rows } as CSSProperties;

  return (
    <main className={styles.screen} data-stage={stage}>
      <CompetitionScreenBackdrop />
      <CompetitionScreenBrand time={formatClock(now)} />

      <section className={styles.contentFrame} aria-label="比赛实时态势">
        <section className={styles.centerStage}>
          <div className={styles.centerStatus}>
            <Image
              alt=""
              aria-hidden
              className={styles.centerStatusCity}
              height={325}
              loading="eager"
              sizes="460px"
              src="/screen/competition-city-tech.webp"
              width={980}
            />
            <div className={styles.stageSummary}><span><Radio />{stageLabels[stage]}</span><small>已发布 {snapshot.summary.publishedQuestions}/{snapshot.summary.questionTotal} 题</small></div>
            <div className={styles.countdown}><span>{countdownLabel}</span><strong>{countdownValue}</strong></div>
          </div>

          <div className={styles.rosterHeading}>
            <span><Users />选手作答<small>按选手姓名拼音首字母顺序排列</small></span>
            <div className={styles.legend}>
              {stage === "finished" && snapshot.summary.questionTotal > 0 ? (
                <span><i className={styles.legendUnfinished} />未完成 {snapshot.summary.unfinished}</span>
              ) : <>
                <span><i className={styles.legendNotStarted} />未开始 {snapshot.summary.notStarted}</span>
                <span><i className={styles.legendDrafting} />答题中 {snapshot.summary.drafting}</span>
              </>}
              <span><i className={styles.legendSubmitted} />已交卷 {snapshot.summary.fullySubmitted}</span>
            </div>
          </div>

          {rankedContestants.length > 0 ? (
            <div className={styles.roster} data-density={density} style={rosterStyle}>
              {rankedContestants.map((contestant, index) => {
                const contestantIndex = index + 1;
                return <ContestantSeat contestant={contestant} index={contestantIndex} key={contestant.id} questionTotal={snapshot.summary.questionTotal} recentlyUpdated={recentProgressChanges.has(contestant.id)} />;
              })}
            </div>
          ) : <div className={styles.emptyRoster}><Users /><strong>暂无参赛选手</strong></div>}

          <div aria-live="polite" className={styles.visuallyHidden} role="status">
            {[...recentProgressChanges.values()].map((change) => `${change.after.name} 答题进度更新`).join("，")}
          </div>

        </section>
      </section>

    </main>
  );
}

function ContestantRank({ rank }: { rank: number }) {
  return (
    <span aria-label={`排序序号 ${rank}`} className={styles.seatRank}>
      <strong aria-hidden>{String(rank).padStart(2, "0")}</strong>
    </span>
  );
}

function ContestantSeat({ contestant, index, questionTotal, recentlyUpdated }: {
  contestant: CompetitionScreenContestant;
  index: number;
  questionTotal: number;
  recentlyUpdated: boolean;
}) {
  const percent = Math.round(progressPercent(contestant, questionTotal));
  const progressCount = competitionScreenProgressCount(contestant, questionTotal);
  const showDuration = contestant.durationSeconds !== null && contestant.durationKind !== null;
  return (
    <article className={styles.contestantSeat} data-contestant-id={contestant.id} data-recently-updated={recentlyUpdated} data-status={contestant.status}>
      <div className={styles.seatIdentity}>
        <ContestantRank rank={index} />
        <strong title={contestant.name}>{contestant.name}</strong>
        <small>{contestant.status === "submitted" && <CheckCircle2 />}{contestantStatusLabels[contestant.status]}</small>
      </div>
      <div className={styles.seatProgress}><i style={{ width: `${percent}%` }} /></div>
      <div className={styles.seatStats} data-duration={showDuration}>
        <span><small>进度</small><strong>{progressCount}/{questionTotal}</strong></span>
        {showDuration && (
          <span><small>{contestant.durationKind === "timeout" ? "已用时" : "总耗时"}</small><strong>{formatDuration(contestant.durationSeconds!)}</strong></span>
        )}
      </div>
    </article>
  );
}
