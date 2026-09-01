"use client";

import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  Activity,
  CheckCircle2,
  Megaphone,
  Radio,
  Users,
} from "lucide-react";

import {
  competitionScreenContestantsByPinyin,
  competitionScreenGrid,
  competitionScreenProgressChanges,
  competitionScreenProgressCount,
  competitionScreenNoticeVisible,
  competitionScreenStageAt,
  type CompetitionScreenContestant,
  type CompetitionScreenContestantStatus,
  type CompetitionScreenProgressChange,
  type CompetitionScreenSnapshot,
  type CompetitionScreenStage,
} from "@/lib/competition/screen-model";
import type { CompetitionScreenNotice } from "@/lib/competition/types";

import CompetitionScreenBackdrop from "./CompetitionScreenBackdrop";
import CompetitionScreenBrand from "./CompetitionScreenBrand";
import styles from "./CompetitionScreen.module.css";

const snapshotIntervalMs = 3_000;
const progressHighlightMs = 1_800;
const tokenMinuteBucketCount = 90;

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

function formatTokenTotal(value: number): string {
  return value.toLocaleString("zh-CN");
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
  noticePreview = false,
}: {
  initialSnapshot: CompetitionScreenSnapshot | null;
  mockMode?: boolean;
  mockStartedAt?: number | null;
  noticePreview?: boolean;
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
  const showPreStartNotice = snapshot.notice.enabled
    && Boolean(snapshot.notice.content.trim())
    && (noticePreview || competitionScreenNoticeVisible({
      competitionState: snapshot.competition.state,
      notice: snapshot.notice,
    }));

  return (
    <main className={styles.screen} data-stage={stage}>
      <CompetitionScreenBackdrop />
      <CompetitionScreenBrand
        countdownLabel={countdownLabel}
        countdownValue={countdownValue}
        stageDetail={`已发布 ${snapshot.summary.publishedQuestions}/${snapshot.summary.questionTotal} 题`}
        stageLabel={stageLabels[stage]}
        time={formatClock(now)}
      />

      <section className={styles.contentFrame} aria-label="比赛实时态势">
        <section className={styles.centerStage}>
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

          <TokenConsumptionChart
            buckets={snapshot.tokenMinutes ?? Array<number>(tokenMinuteBucketCount).fill(0)}
            totalTokens={snapshot.summary.totalTokens}
          />
        </section>
      </section>

      {showPreStartNotice && <PreStartNoticeOverlay notice={snapshot.notice} />}

    </main>
  );
}

function PreStartNoticeOverlay({ notice }: { notice: CompetitionScreenNotice }) {
  const contentLength = notice.content.length;
  const density = contentLength <= 72
    ? "huge"
    : contentLength <= 160
      ? "large"
      : contentLength <= 300
        ? "medium"
        : "compact";
  const lines = notice.content.split(/\r?\n/);

  return (
    <section
      aria-labelledby="pre-start-notice-title"
      aria-modal="true"
      className={styles.preStartNoticeLayer}
      role="dialog"
    >
      <div className={styles.preStartNoticeDialog} data-density={density}>
        <span className={styles.preStartNoticeLabel}><Megaphone />赛前公告</span>
        <h2 id="pre-start-notice-title">{notice.title}</h2>
        <div className={styles.preStartNoticeContent}>
          {lines.map((line, index) => (
            <p data-url={/^https?:\/\/\S+$/i.test(line.trim())} key={`${index}-${line}`}>
              {line || <br />}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

function RollingTokenTotal({ value }: { value: number }) {
  const [displayValue, setDisplayValue] = useState(value);
  const currentValue = useRef(value);

  useEffect(() => {
    const from = currentValue.current;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const duration = reducedMotion ? 0 : 900;
    const startedAt = performance.now();
    let frame = 0;

    const update = (timestamp: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (timestamp - startedAt) / duration);
      const eased = 1 - (1 - progress) ** 3;
      const nextValue = Math.round(from + (value - from) * eased);
      currentValue.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) frame = window.requestAnimationFrame(update);
    };

    frame = window.requestAnimationFrame(update);
    return () => window.cancelAnimationFrame(frame);
  }, [value]);

  return <strong aria-label={`${formatTokenTotal(value)} 词元`}>{formatTokenTotal(displayValue)}</strong>;
}

function TokenConsumptionChart({ buckets, totalTokens }: { buckets: number[]; totalTokens: number }) {
  const chartWidth = 1200;
  const chartHeight = 100;
  const chartLeft = 10;
  const chartRight = chartWidth - chartLeft;
  const chartBottom = 94;
  const chartTop = 8;
  const maxValue = Math.max(1, ...buckets);
  const slotWidth = (chartRight - chartLeft) / Math.max(1, buckets.length);
  const barWidth = Math.max(6, slotWidth * .58);

  return (
    <figure className={styles.tokenFlowPanel} data-active={totalTokens > 0}>
      <Image
        alt=""
        aria-hidden
        className={styles.tokenFlowScenery}
        height={340}
        loading="eager"
        sizes="100vw"
        src="/screen/competition-eco-strip.webp"
        width={1672}
      />
      <figcaption className={styles.tokenFlowHeader}>
        <span className={styles.tokenFlowTitle}><Activity /><strong>实时AI算力消耗统计</strong></span>
        <span className={styles.tokenFlowTotal}>
          <RollingTokenTotal value={totalTokens} />
          <small>词元</small>
        </span>
      </figcaption>
      <div className={styles.tokenFlowChart}>
        <svg aria-label={`本场共消耗 ${totalTokens} 词元`} preserveAspectRatio="none" role="img" viewBox={`0 0 ${chartWidth} ${chartHeight}`}>
          <defs>
            <linearGradient id="token-minute-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#7cf0d0" stopOpacity=".95" />
              <stop offset="1" stopColor="#3ec8ff" stopOpacity=".28" />
            </linearGradient>
          </defs>
          <g className={styles.tokenFlowGrid}>
            <path d="M0 30H1200M0 60H1200M0 90H1200" />
            <path d="M200 0V100M400 0V100M600 0V100M800 0V100M1000 0V100" />
          </g>
          {buckets.map((value, index) => {
            const scale = Math.max(.025, value / maxValue);
            const x = chartLeft + index * slotWidth + (slotWidth - barWidth) / 2;
            const style = {
              "--token-bar-delay": `${index * 4}ms`,
              "--token-bar-scale": scale,
            } as CSSProperties;
            return <rect className={styles.tokenMinuteBar} height={chartBottom - chartTop} key={index} rx="2" style={style} width={barWidth} x={x} y={chartTop} />;
          })}
        </svg>
      </div>
    </figure>
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
