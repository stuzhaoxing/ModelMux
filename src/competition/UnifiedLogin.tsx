"use client";

import { ArrowRight, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SYSTEM_NAME } from "@/lib/branding";
import type { SessionUser } from "@/lib/competition/types";
import { operationModePresentation, useOperationMode } from "./OperationModeBanner";

export default function UnifiedLogin({ next }: { next: string | null }) {
  const router = useRouter();
  const { mode } = useOperationMode();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/competition/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ username, password, next }),
      });
      const payload = await response.json().catch(() => ({})) as
        { user?: SessionUser; redirectTo?: string; error?: string };
      if (!response.ok || !payload.redirectTo) {
        throw new Error(payload.error || `登录失败（HTTP ${response.status}）`);
      }
      // 页面鉴权在服务端组件里做，刷新一次才能让它读到刚写入的会话 cookie。
      router.replace(payload.redirectTo);
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={`competition-login unified mode-${mode ?? "unknown"}`}>
      <section className="login-panel">
        {mode && (
          <div className={`login-mode-badge ${mode}`} role="status">
            <span className="operation-mode-pulse" aria-hidden="true" />
            <strong>{operationModePresentation[mode].label}</strong>
            <small>{operationModePresentation[mode].headline}</small>
          </div>
        )}
        <div className="login-brand">
          <span className="competition-brand-mark"><span /><span /><span /></span>
          <span><strong>{SYSTEM_NAME}</strong><small>现场考核系统</small></span>
        </div>
        <h1>选手登录</h1>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void signIn();
          }}
        >
          <label>账号
            <input
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label>密码
            <input
              autoComplete="current-password"
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary-action login-action" disabled={pending} type="submit">
            {pending ? <LoaderCircle className="spinning" /> : <ArrowRight />}
            {pending ? "正在登录" : "进入答题系统"}
          </button>
        </form>
        <span className="login-footnote">选手账号由系统管理员统一发放</span>
      </section>
    </main>
  );
}
