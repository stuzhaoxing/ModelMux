import { competitionPool, isCompetitionDatabaseConfigured } from "./db";

export type DatabaseProbeError =
  | "timeout"
  | "unreachable"
  | "auth_failed"
  | "missing_database"
  | "error";

export interface CompetitionDatabaseHealth {
  configured: boolean;
  reachable: boolean;
  error: DatabaseProbeError | null;
}

const probeTimeoutMs = 2_000;
const probeTimeoutMessage = "database_probe_timeout";

/**
 * /health 不需要登录，所以只回固定的分类码。mysql2 的原始报错里带着
 * 主机、端口和账号名，直接透出去等于把内网连接信息挂在公网上。
 */
export function databaseProbeErrorCode(error: unknown): DatabaseProbeError {
  if (error instanceof Error && error.message === probeTimeoutMessage) return "timeout";
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "ETIMEDOUT" || code === "PROTOCOL_SEQUENCE_TIMEOUT") return "timeout";
  if (code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "EHOSTUNREACH" || code === "ECONNRESET") {
    return "unreachable";
  }
  if (code.startsWith("ER_ACCESS_DENIED") || code === "ER_NOT_SUPPORTED_AUTH_MODE") return "auth_failed";
  if (code === "ER_BAD_DB_ERROR") return "missing_database";
  return "error";
}

/**
 * 只做一次 SELECT 1，不触发建表。健康检查要能在库挂掉时快速返回，
 * 所以额外套一层超时：连接池排队时 mysql2 自己不会及时报错。
 */
export async function competitionDatabaseHealth(): Promise<CompetitionDatabaseHealth> {
  if (!isCompetitionDatabaseConfigured()) {
    return { configured: false, reachable: false, error: null };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      competitionPool().query("SELECT 1"),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(probeTimeoutMessage)), probeTimeoutMs);
      }),
    ]);
    return { configured: true, reachable: true, error: null };
  } catch (error) {
    return { configured: true, reachable: false, error: databaseProbeErrorCode(error) };
  } finally {
    clearTimeout(timer);
  }
}
