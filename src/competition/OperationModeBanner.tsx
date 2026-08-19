"use client";

import { FlaskConical, Trophy } from "lucide-react";
import { useEffect, useState } from "react";

import type { OperationMode } from "@/lib/gateway/operation-mode";

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
    headline: "正式比赛进行中，所有操作计入成绩",
  },
  test: {
    label: "测试模式",
    headline: "赛前测试环境，数据不计入成绩",
  },
};

/**
 * 模式先由 /api/competition/mode 拉一次，之后由 SSE 的 mode 事件推送更新，
 * 所以答题过程中管理员切换模式，两个端上的横幅会自己跟着变。
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

export function OperationModeBanner({ mode }: { mode: OperationMode | null }) {
  if (!mode) return null;
  const presentation = operationModePresentation[mode];
  const Icon = mode === "competition" ? Trophy : FlaskConical;

  return (
    <div className={`operation-mode-banner ${mode}`} role="status" aria-live="polite">
      <span className="operation-mode-icon"><Icon /></span>
      <strong className="operation-mode-label">
        <span className="operation-mode-pulse" aria-hidden="true" />
        {presentation.label}
      </strong>
      <span className="operation-mode-headline">{presentation.headline}</span>
    </div>
  );
}
