"use client";

import { ArrowRight, LoaderCircle, Radio } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";

import CompetitionScreenBackdrop from "./CompetitionScreenBackdrop";
import CompetitionScreenBrand from "./CompetitionScreenBrand";
import styles from "./CompetitionScreen.module.css";

export default function CompetitionScreenLogin({ configured }: { configured: boolean }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/competition/screen/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || `登录失败（HTTP ${response.status}）`);
      router.refresh();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "登录失败");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className={styles.loginShell}>
      <CompetitionScreenBackdrop />
      <CompetitionScreenBrand />
      <Image
        alt=""
        aria-hidden
        className={styles.loginEcoStrip}
        height={340}
        loading="eager"
        sizes="100vw"
        src="/screen/competition-eco-strip.webp"
        width={1672}
      />
      <Image
        alt=""
        aria-hidden
        className={styles.loginCityTech}
        height={325}
        loading="eager"
        sizes="50vw"
        src="/screen/competition-city-tech.webp"
        width={980}
      />

      <section className={styles.loginPanel}>
        <div className={styles.loginPanelHeader}><Radio /><strong>比赛实时态势</strong></div>
        <form className={styles.loginForm} onSubmit={submit}>
          <label>
            访问密码
            <input
              autoFocus
              autoComplete="current-password"
              disabled={!configured}
              required
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {!configured && <div className={styles.loginError} role="alert">大屏访问密码尚未配置</div>}
          {error && <div className={styles.loginError} role="alert">{error}</div>}
          <button className={styles.loginButton} disabled={pending || !configured} type="submit">
            {pending ? <LoaderCircle className="spinning" /> : <ArrowRight />}
            {pending ? "正在验证" : "进入比赛大屏"}
          </button>
        </form>
      </section>
    </main>
  );
}
