/**
 * 浏览器只会在连接被中断时自己重连 EventSource；服务重启期间反向代理
 * 返回 502、或会话失效返回 401 时，EventSource 直接进入 CLOSED 再也不重试，
 * 页面就会一直停在"离线"，必须手动刷新。所以前端自己退避重连。
 */
export function eventStreamRetryDelayMs(
  attempt: number,
  baseMs = 1_000,
  maxMs = 15_000,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const delay = baseMs * 2 ** (safeAttempt - 1);
  return Math.min(delay, maxMs);
}
