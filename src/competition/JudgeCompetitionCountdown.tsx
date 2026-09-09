"use client";

import { useEffect, useRef, useState } from "react";

import { competitionRemainingSeconds } from "@/lib/competition/control";
import { formatJudgeCountdown } from "@/lib/competition/judge-dashboard";
import type { CompetitionControl } from "@/lib/competition/types";

type CountdownProps = {
  competition: CompetitionControl;
  onExpired: () => void;
};

export function JudgeCompetitionCountdown(props: CountdownProps) {
  // A new start or deadline needs a fresh clock before its very first paint.
  // Keep the dashboard itself mounted so exports and confirmations are preserved.
  return <RunningCountdown key={`${props.competition.startedAt}:${props.competition.endsAt}`} {...props} />;
}

function RunningCountdown({ competition, onExpired }: CountdownProps) {
  const [now, setNow] = useState(() => Date.now());
  const expired = useRef(false);
  const remainingSeconds = competitionRemainingSeconds(competition, now);

  useEffect(() => {
    if (!competition.endsAt || expired.current) return;
    const endsAt = Date.parse(competition.endsAt);
    const notifyExpired = () => {
      if (expired.current) return;
      expired.current = true;
      onExpired();
    };
    if (Date.now() >= endsAt) {
      notifyExpired();
      return;
    }
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= endsAt) {
        window.clearInterval(timer);
        notifyExpired();
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [competition.endsAt, onExpired]);

  return <div className="dashboard-publish-countdown" data-finished={remainingSeconds === 0} aria-live="polite">
    <span>比赛剩余时间</span>
    <strong>{formatJudgeCountdown(remainingSeconds)}</strong>
  </div>;
}
