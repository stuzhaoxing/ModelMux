export async function apiRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers, cache: "no-store" });
  const payload = await response.json().catch(() => ({})) as { error?: string } & T;
  if (
    response.status === 401 &&
    url.startsWith("/api/admin/") &&
    url !== "/api/admin/auth/login" &&
    typeof window !== "undefined"
  ) {
    window.dispatchEvent(new Event("modelmux-admin-unauthorized"));
  }
  // 选手/评委端的会话是在服务端组件里校验的，页面打开后才过期的话只有接口会 401，
  // 这时直接退回统一登录页，并记住当前路径以便登录后跳回来。
  if (
    response.status === 401 &&
    url.startsWith("/api/competition/") &&
    typeof window !== "undefined"
  ) {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.replace(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!response.ok) throw new Error(payload.error || `请求失败（HTTP ${response.status}）`);
  return payload;
}

export function formatCompetitionTime(value: string | null): string {
  if (!value) return "--";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}+08:00`;
  return new Date(normalized).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export function formatCompetitionClock(value: string | null): string {
  if (!value) return "--:--:--";
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}+08:00`;
  return new Date(normalized).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}
