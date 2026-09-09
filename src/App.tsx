"use client";

import {
  Activity,
  BookOpenText,
  CircleAlert,
  FileClock,
  FlaskConical,
  ListTree,
  LogOut,
  RefreshCw,
  Router,
  Trophy,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  adminViewFromPathname,
  adminViewPaths,
  type AdminViewId,
  isAdminJudgeViewId,
} from "@/lib/admin/navigation";
import { SYSTEM_NAME } from "@/lib/branding";
import type { CompetitionControl } from "@/lib/competition/types";
import type { GatewayStatus, RequestLog } from "@/lib/gateway/types";
import AdminAccounts from "@/src/competition/AdminAccounts";
import JudgeActivityPage from "@/src/competition/JudgeActivityPage";
import JudgeApp from "@/src/competition/JudgeApp";
import { JudgeCompetitionStatus } from "@/src/competition/JudgeCompetitionStatus";

interface AdminStatusResponse {
  gateway: GatewayStatus;
  logs: RequestLog[];
}

const navItems: Array<{
  id: AdminViewId;
  label: string;
  icon: LucideIcon;
  activeViews?: AdminViewId[];
}> = [
  {
    id: "competition",
    label: "考务总览",
    icon: Activity,
  },
  {
    id: "questions",
    label: "题目管理",
    icon: BookOpenText,
    activeViews: ["questions", "answers"],
  },
  { id: "activity", label: "现场日志", icon: ListTree },
  { id: "accounts" as const, label: "选手账号", icon: UserCog },
  { id: "models" as const, label: "模型路由", icon: Router },
  { id: "logs" as const, label: "调用日志", icon: FileClock },
];

const viewTitles: Record<AdminViewId, string> = {
  competition: "考务总览",
  questions: "题目管理",
  answers: "答卷查看",
  activity: "现场日志",
  accounts: "选手账号",
  models: "模型路由",
  logs: "调用日志",
};

function stateLabel(state: GatewayStatus["state"]): string {
  if (state === "running") return "网关运行中";
  return "网关待配置";
}

type OperationMode = GatewayStatus["operationMode"];

const operationModeCopy: Record<
  OperationMode,
  { label: string; summary: string }
> = {
  test: {
    label: "测试模式",
    summary: "用于赛前联调和现场演练。",
  },
  competition: {
    label: "比赛模式",
    summary: "用于正式比赛期间的现场状态展示。",
  },
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString("zh-CN", { hour12: false });
}

function apiHost(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}

export default function App() {
  const pathname = usePathname();
  const router = useRouter();
  const activeView = adminViewFromPathname(pathname);
  const [status, setStatus] = useState<AdminStatusResponse | null>(null);
  const [competition, setCompetition] = useState<CompetitionControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const updateCompetitionMode = useCallback((mode: OperationMode) => {
    setStatus((current) => current ? { ...current, gateway: { ...current.gateway, operationMode: mode } } : current);
  }, []);

  const refreshGateway = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/status", { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/admin/login");
        router.refresh();
        return;
      }
      if (!response.ok) throw new Error(`状态接口返回 HTTP ${response.status}`);
      setStatus((await response.json()) as AdminStatusResponse);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error ? refreshError.message : String(refreshError),
      );
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    let active = true;
    fetch("/api/admin/status", { cache: "no-store" })
      .then((response) => {
        if (response.status === 401) {
          router.replace("/admin/login");
          router.refresh();
          throw new Error("管理员登录状态已失效");
        }
        if (!response.ok) throw new Error(`状态接口返回 HTTP ${response.status}`);
        return response.json() as Promise<AdminStatusResponse>;
      })
      .then((nextStatus) => {
        if (!active) return;
        setStatus(nextStatus);
        setError(null);
      })
      .catch((initialError: unknown) => {
        if (!active) return;
        setError(initialError instanceof Error ? initialError.message : String(initialError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshGateway, router]);

  useEffect(() => {
    const handleUnauthorized = () => {
      router.replace("/admin/login");
      router.refresh();
    };
    window.addEventListener("modelmux-admin-unauthorized", handleUnauthorized);
    return () => window.removeEventListener("modelmux-admin-unauthorized", handleUnauthorized);
  }, [router]);

  async function logoutAdmin() {
    await fetch("/api/admin/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/admin/login");
    router.refresh();
  }

  const gateway = status?.gateway;
  const state = gateway?.state ?? "needs_config";
  const mode = gateway?.deploymentMode ?? "local";
  const operationMode = gateway?.operationMode ?? "test";
  const judgeViewActive = isAdminJudgeViewId(activeView);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>{SYSTEM_NAME}</strong>
          </div>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.activeViews?.includes(activeView) ?? activeView === item.id;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={active ? "nav-item active" : "nav-item"}
                href={adminViewPaths[item.id]}
                key={item.id}
                title={item.label}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-status">
          <span className={`status-dot ${state}`} />
          <div>
            <strong>{stateLabel(state)}</strong>
            <span>{gateway ? apiHost(gateway.apiBase) : "connecting"}</span>
          </div>
        </div>
      </aside>

      <main className="main-workspace">
        <header className="topbar">
          <div>
            <span className="context-label">
              竞赛系统 / {mode === "public" ? "PUBLIC" : "LOCAL"}
            </span>
            <h1>{viewTitles[activeView]}</h1>
          </div>
          <div className="topbar-actions">
            {judgeViewActive ? <JudgeCompetitionStatus competition={competition} /> : <span className={`operation-mode-pill ${operationMode}`} title={operationModeCopy[operationMode].summary}>
              {operationMode === "competition" ? <Trophy size={14} /> : <FlaskConical size={14} />}
              {operationModeCopy[operationMode].label}
            </span>}
            <span className="admin-identity">管理员</span>
            <span className={`service-pill ${state}`} title="模型网关服务状态，与比赛是否开始或结束无关">
              <span className="status-dot" />
              {stateLabel(state)}
            </span>
            <button
              aria-label="刷新状态"
              className="icon-button"
              onClick={() => void refreshGateway()}
              title="刷新状态"
              type="button"
            >
              <RefreshCw className={loading ? "spinning" : ""} size={17} />
            </button>
            <button
              aria-label="退出管理员登录"
              className="icon-button"
              onClick={() => void logoutAdmin()}
              title="退出登录"
              type="button"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        <div className={`page-content ${judgeViewActive ? "judge-page-content" : ""} ${activeView === "activity" ? "activity-page-content" : ""}`}>
          {error && (
            <div className="error-banner" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </div>
          )}

          {!gateway || !status ? (
            <LoadingView />
          ) : (
            <>
              {judgeViewActive && <JudgeApp onModeChange={updateCompetitionMode} onCompetitionChange={setCompetition} />}
              {activeView === "activity" && <JudgeActivityPage />}
              {activeView === "accounts" && <AdminAccounts />}
              {activeView === "models" && <ModelsView gateway={gateway} />}
              {activeView === "logs" && <LogsView logs={status.logs} />}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function LoadingView() {
  return (
    <section className="workspace-panel loading-panel" aria-live="polite">
      <RefreshCw className="spinning" size={20} />
      <span>正在读取网关状态</span>
    </section>
  );
}

function ModelsView({ gateway }: { gateway: GatewayStatus }) {
  const families = [
    { id: "deepseek" as const, name: "DeepSeek", note: "DeepSeek 官方直供" },
    { id: "qwen" as const, name: "Qwen", note: "阿里云百炼原厂直供" },
    { id: "glm" as const, name: "GLM", note: "阿里云百炼 · 智谱原厂直供" },
    { id: "kimi" as const, name: "Kimi", note: "阿里云百炼 · Moonshot 原厂直供" },
    { id: "minimax" as const, name: "MiniMax", note: "阿里云百炼 · MiniMax 原厂直供" },
    { id: "doubao" as const, name: "豆包", note: "火山方舟官方路由" },
    { id: "custom" as const, name: "自定义模型", note: "通过 MODELMUX_ROUTES_JSON 配置" },
  ];
  const providerNames: Record<string, string> = {
    aliyun: "阿里云百炼",
    "aliyun-zhipu": "百炼 · 智谱直供",
    "aliyun-kimi": "百炼 · Moonshot 直供",
    "aliyun-minimax": "百炼 · MiniMax 直供",
    ark: "火山方舟",
    deepseek: "DeepSeek 官方",
  };
  const tierNames = {
    flash: "Flash",
    pro: "Pro",
    plus: "Plus",
    max: "Max",
    flagship: "Flagship",
    custom: "Custom",
  };

  return (
    <section className="workspace-panel full-panel">
      <div className="panel-heading table-heading">
        <div>
          <span className="field-label">MODEL ROUTING</span>
          <h2>公开模型与供应商路由</h2>
        </div>
        <span className="record-count">{gateway.modelAliases.length} 个公开型号</span>
      </div>
      <div className="model-catalog">
        {families.map((family) => {
          const models = gateway.modelAliases.filter(
            (model) => model.family === family.id,
          );
          if (models.length === 0) return null;
          return (
            <section className="model-family" key={family.id}>
              <div className="model-family-heading">
                <div>
                  <strong>{family.name}</strong>
                  <span>{family.note}</span>
                </div>
                <span>{models.length} 个档位</span>
              </div>
              {models.map((model) => (
                <div className="model-product-row" key={model.alias}>
                  <div className={`model-tier-mark ${model.tier}`} aria-hidden="true">
                    {tierNames[model.tier].slice(0, 1)}
                  </div>
                  <div className="model-product">
                    <div className="model-product-title">
                      <strong>{model.displayName}</strong>
                      <span className={`model-tier-label ${model.tier}`}>
                        {tierNames[model.tier]}
                      </span>
                    </div>
                    <code>{model.alias}</code>
                    <p>{model.description}</p>
                  </div>
                  <div className="provider-routes">
                    {model.routes.map((route, index) => (
                      <div className="provider-route" key={`${route.provider}:${route.upstreamModel}`}>
                        <span className="route-priority">P{index + 1}</span>
                        <strong>{providerNames[route.provider] ?? route.provider}</strong>
                        <code title={route.upstreamModel}>{route.upstreamModel}</code>
                        <span className={`route-state ${route.configured ? "success" : "warning"}`}>
                          <i aria-hidden="true" />
                          {route.configured ? "已配置" : "未配置"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function LogsView({ logs }: { logs: RequestLog[] }) {
  return (
    <section className="workspace-panel full-panel">
      <div className="panel-heading table-heading">
        <div>
          <span className="field-label">PROCESS LOG</span>
          <h2>请求记录</h2>
        </div>
        <span className="record-count">最近 {logs.length} 条</span>
      </div>
      <div className="data-table logs-table">
        <div className="table-row table-header">
          <span>时间</span><span>凭证</span><span>模型 / 供应商</span><span>耗时</span><span>结果</span>
        </div>
        {logs.length === 0 ? (
          <div className="empty-state table-empty">
            <BookOpenText size={24} />
            <strong>还没有调用日志</strong>
            <span>当前只保留本进程最近 100 条元数据</span>
          </div>
        ) : (
          logs.map((log) => (
            <div className="table-row log-row" key={log.id}>
              <span>{formatDate(log.timestamp)}</span>
              <span>{log.client}</span>
              <span>{log.model} / {log.provider ?? "-"}</span>
              <span>{log.durationMs} ms</span>
              <span className={`check-state ${log.status < 400 ? "success" : "danger"}`}>{log.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
