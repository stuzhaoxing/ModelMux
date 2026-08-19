export type HealthStatus = "ok" | "needs_config" | "degraded" | "suspended";

export interface HealthOutcome {
  status: HealthStatus;
  ready: boolean;
}

/**
 * 三个信号的优先级：考核数据库先于一切。停服开关只关掉模型 API，
 * 答题、评委工作台和登录仍然全靠 MySQL，所以数据库不可用时无论
 * 停服开关在哪个位置，健康检查都必须报 degraded 并返回 503，
 * 否则比赛现场的监控会在库已经挂掉时继续看到 200 ok。
 */
export function healthOutcome(input: {
  serviceEnabled: boolean;
  configured: boolean;
  databaseReady: boolean;
}): HealthOutcome {
  if (!input.databaseReady) return { status: "degraded", ready: false };
  if (!input.serviceEnabled) return { status: "suspended", ready: true };
  return input.configured
    ? { status: "ok", ready: true }
    : { status: "needs_config", ready: false };
}
