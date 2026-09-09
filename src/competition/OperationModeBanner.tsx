"use client";

import { CircleStop, FlaskConical, Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import type { OperationMode } from "@/lib/gateway/operation-mode";
import { competitionIsTesting } from "@/lib/competition/control";
import type { CompetitionControl } from "@/lib/competition/types";

export interface OperationModePresentation {
  label: string;
  headline: string;
}

export const operationModePresentation: Record<
  OperationMode,
  OperationModePresentation
> = {
  competition: {
    label: "比赛模式",
    headline: "正式比赛，作答计入成绩",
  },
  test: {
    label: "测试模式",
    headline: "赛前测试环境，数据不计入成绩",
  },
};

/**
 * 模式先由 /api/competition/mode 拉一次，之后由 SSE 的 mode 事件推送更新，
 * 正式比赛开始后，两个端上的横幅同步进入比赛模式。
 */
export function useOperationMode() {
  const [mode, setMode] = useState<OperationMode | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/competition/mode", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { mode: OperationMode } | null) => {
        if (active && payload) setMode(payload.mode);
      })
      // 读不到就保留上一次已知模式，横幅不闪烁。
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return { mode, setMode };
}

export function OperationModeBanner({ competition }: { competition: CompetitionControl | null }) {
  if (!competition) return null;
  const state = competitionIsTesting(competition) ? "not_started" : competition.state;
  const { label, headline, tone, Icon } = {
    not_started: { label: "测试", headline: "赛前测试环境，数据不计入成绩", tone: "test", Icon: FlaskConical },
    running: { label: "比赛中", headline: "正式比赛，作答计入成绩", tone: "competition", Icon: Trophy },
    ended: { label: "比赛已结束", headline: "已停止作答，已保存和提交的答案会继续保留", tone: "ended", Icon: CircleStop },
  }[state];

  return (
    <div className={`operation-mode-banner ${tone}`} role="status" aria-live="polite">
      <span className="operation-mode-icon"><Icon /></span>
      <strong className="operation-mode-label">
        <span className="operation-mode-pulse" aria-hidden="true" />
        {label}
      </strong>
      <span className="operation-mode-headline">{headline}</span>
    </div>
  );
}
