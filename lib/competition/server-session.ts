import { cookies } from "next/headers";

import { sessionCookieName, sessionUserFromToken } from "./auth";
import type { SessionUser } from "./types";

/**
 * 服务端组件里的登录校验。数据库不可用时按"未登录"处理，
 * 这样登录页/业务页至少能渲染出来并给出可读的错误，而不是整页 500。
 */
export async function sessionUserFromCookies(): Promise<SessionUser | null> {
  try {
    const token = (await cookies()).get(sessionCookieName)?.value;
    return await sessionUserFromToken(token);
  } catch (error) {
    console.error("Competition session lookup failed", error);
    return null;
  }
}
