import type { GatewayMetrics, RequestLog } from "./types";

interface GatewayRuntimeState {
  startedAt: number;
  keyCursor: Map<string, number>;
  logs: RequestLog[];
  clients: Set<string>;
  requests: number;
  successfulRequests: number;
  failedRequests: number;
}

declare global {
  var __modelmuxRuntime: GatewayRuntimeState | undefined;
}

const runtime: GatewayRuntimeState = globalThis.__modelmuxRuntime ?? {
  startedAt: Math.floor(Date.now() / 1000),
  keyCursor: new Map(),
  logs: [],
  clients: new Set(),
  requests: 0,
  successfulRequests: 0,
  failedRequests: 0,
};

globalThis.__modelmuxRuntime = runtime;

export function startedAt(): number {
  return runtime.startedAt;
}

export function nextProviderKey(poolId: string, keys: string[]): string {
  const cursor = runtime.keyCursor.get(poolId) ?? 0;
  const key = keys[cursor % keys.length];
  runtime.keyCursor.set(poolId, (cursor + 1) % keys.length);
  return key;
}

export function recordRequest(log: RequestLog): void {
  runtime.requests += 1;
  if (log.status >= 200 && log.status < 400) runtime.successfulRequests += 1;
  else runtime.failedRequests += 1;
  runtime.clients.add(log.client);
  runtime.logs.unshift(log);
  if (runtime.logs.length > 100) runtime.logs.length = 100;
}

export function recentLogs(limit = 20): RequestLog[] {
  return runtime.logs.slice(0, limit);
}

export function metrics(): GatewayMetrics {
  return {
    requests: runtime.requests,
    successfulRequests: runtime.successfulRequests,
    failedRequests: runtime.failedRequests,
    activeClients: runtime.clients.size,
    successRate:
      runtime.requests === 0
        ? null
        : Math.round((runtime.successfulRequests / runtime.requests) * 10_000) / 100,
  };
}
