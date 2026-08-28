"use client";

import { ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { SYSTEM_NAME } from "@/lib/branding";
import { apiRequest } from "@/src/competition/api";

export default function AdminLogin() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest("/api/admin/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      router.replace("/admin");
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="competition-login admin">
      <section className="login-panel">
        <div className="login-brand">
          <span className="competition-brand-mark"><span /><span /><span /></span>
          <span><strong>{SYSTEM_NAME}</strong><small>管理后台</small></span>
        </div>
        <div className="login-role-icon"><ShieldCheck /></div>
        <h1>管理员登录</h1>
        <p>管理考务、答卷、选手账号与模型网关</p>
        <form onSubmit={submit}>
          <label>管理密码<input autoFocus autoComplete="current-password" required type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <div className="login-error" role="alert">{error}</div>}
          <button className="primary-action login-action" disabled={pending} type="submit">
            {pending ? <LoaderCircle className="spinning" /> : <ArrowRight />}
            {pending ? "正在验证" : "进入管理后台"}
          </button>
        </form>
        <span className="login-footnote">评委工作台已并入管理后台，无需单独账号</span>
      </section>
    </main>
  );
}
