export type HealthStatus = "ok" | "needs_config" | "degraded";

export interface HealthOutcome {
  status: HealthStatus;
  ready: boolean;
}

// 答题和登录依赖 MySQL，数据库故障必须优先报告。
export function healthOutcome(input: {
  serviceEnabled: boolean;
  configured: boolean;
  databaseReady: boolean;
}): HealthOutcome {
  if (!input.databaseReady) return { status: "degraded", ready: false };
  return input.configured
    ? { status: "ok", ready: true }
    : { status: "needs_config", ready: false };
}
