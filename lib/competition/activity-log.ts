import type { ActivityAction, ActivityCategory, ActivityOutcome } from "./types";

const actionLabels: Record<ActivityAction, string> = {
  login: "登录系统",
  logout: "退出登录",
  "answer-started": "开始作答",
  "answer-saved": "保存草稿",
  "answer-submitted": "提交答卷",
  "question-created": "新建题目",
  "question-updated": "修改题目",
  "question-deleted": "删除题目",
  "question-published": "发布题目",
  "question-closed": "关闭题目",
  "competition-started": "开始比赛",
  "competition-stopped": "停止比赛",
  "model-call": "调用模型",
  "model-rejected": "调用被拒绝",
};

const categoryLabels: Record<ActivityCategory, string> = {
  auth: "登录",
  answer: "答题",
  question: "题目",
  model: "模型调用",
};

const gatewayErrorLabels: Record<string, string> = {
  quota_exceeded: "额度已用完",
  rate_limit_exceeded: "调用频率超限",
  upstream_rate_limited: "上游限流",
  upstream_timeout: "上游超时",
  upstream_unreachable: "无法连接上游",
  upstream_error: "上游返回错误",
  provider_not_configured: "该模型未配置供应商",
};

export function activityActionLabel(action: string): string {
  return actionLabels[action as ActivityAction] ?? action;
}

export function activityCategoryLabel(category: ActivityCategory): string {
  return categoryLabels[category];
}

export function gatewayErrorLabel(code: string): string {
  return gatewayErrorLabels[code] ?? "调用失败";
}

export function modelCallDetail(input: {
  model: string;
  durationMs: number;
  errorCode: string | null;
  remaining: number | null;
}): string {
  const parts = [input.model, `${(input.durationMs / 1000).toFixed(1)}s`];
  if (input.errorCode) parts.push(gatewayErrorLabel(input.errorCode));
  else if (input.remaining !== null) parts.push(`剩余 ${input.remaining} 次`);
  return parts.join(" · ");
}

export function outcomeForStatus(status: number): ActivityOutcome {
  if (status < 400) return "ok";
  return status === 429 ? "warn" : "error";
}

const draftSaveSeen = new Map<string, number>();

/**
 * Contestants can hit 保存草稿 repeatedly while polishing an answer, and every
 * draft save would bury the entries a judge actually watches for. One line per
 * contestant/question per window is enough to show who is still working.
 */
export function shouldRecordDraftSave(
  key: string,
  now: number,
  windowMs = 60_000,
): boolean {
  const last = draftSaveSeen.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  draftSaveSeen.set(key, now);
  return true;
}
