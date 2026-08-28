"use client";

import {
  Activity,
  BookOpenText,
  Cable,
  Check,
  ChevronRight,
  CircleAlert,
  Clipboard,
  FileClock,
  FlaskConical,
  Gavel,
  Gauge,
  Globe2,
  KeyRound,
  LogOut,
  Network,
  Power,
  RefreshCw,
  Router,
  ServerCog,
  Settings,
  Trophy,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  adminViewFromPathname,
  adminViewPaths,
  type AdminViewId,
  isAdminJudgeViewId,
} from "@/lib/admin/navigation";
import { SYSTEM_NAME } from "@/lib/branding";
import type {
  GatewayMetrics,
  GatewayStatus,
  GatewayIngressEndpoint,
  RequestLog,
} from "@/lib/gateway/types";
import AdminAccounts from "@/src/competition/AdminAccounts";
import JudgeApp from "@/src/competition/JudgeApp";

interface AdminStatusResponse {
  gateway: GatewayStatus;
  metrics: GatewayMetrics;
  logs: RequestLog[];
}

const navItems: Array<{
  id: AdminViewId;
  label: string;
  icon: LucideIcon;
  activeViews?: AdminViewId[];
}> = [
  { id: "overview" as const, label: "总览", icon: Gauge },
  {
    id: "competition",
    label: "考务工作台",
    icon: Gavel,
    activeViews: ["competition", "questions", "answers"],
  },
  { id: "accounts" as const, label: "选手账号", icon: UserCog },
  { id: "models" as const, label: "模型路由", icon: Router },
  { id: "logs" as const, label: "调用日志", icon: FileClock },
  { id: "settings" as const, label: "系统设置", icon: Settings },
];

const viewTitles: Record<AdminViewId, string> = {
  overview: "网关总览",
  competition: "考务工作台",
  questions: "题目管理",
  answers: "答卷查看",
  accounts: "选手账号",
  models: "模型路由",
  logs: "调用日志",
  settings: "系统设置",
};

function stateLabel(state: GatewayStatus["state"]): string {
  if (state === "running") return "运行中";
  if (state === "suspended") return "已停止";
  return "待配置";
}

function deploymentLabel(mode: GatewayStatus["deploymentMode"]): string {
  return mode === "public" ? "赛前公网" : "赛中本地";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const startedTime = useMemo(() => {
    if (!status) return "读取中";
    return formatDate(status.gateway.startedAt * 1000);
  }, [status]);

  async function copyApiBase() {
    if (!status) return;
    await navigator.clipboard.writeText(status.gateway.apiBase);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

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
            <span className={`operation-mode-pill ${operationMode}`} title={operationModeCopy[operationMode].summary}>
              {operationMode === "competition" ? <Trophy size={14} /> : <FlaskConical size={14} />}
              {operationModeCopy[operationMode].label}
            </span>
            <span className="admin-identity">管理员</span>
            <span className={`service-pill ${state}`}>
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

        <div className={`page-content ${judgeViewActive ? "judge-page-content" : ""}`}>
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
              {activeView === "overview" && (
                <Overview
                  copied={copied}
                  gateway={gateway}
                  logs={status.logs}
                  metrics={status.metrics}
                  onCopy={() => void copyApiBase()}
                  onOpenSettings={() => router.push(adminViewPaths.settings)}
                  startedTime={startedTime}
                />
              )}
              {judgeViewActive && <JudgeApp />}
              {activeView === "accounts" && <AdminAccounts />}
              {activeView === "models" && <ModelsView gateway={gateway} />}
              {activeView === "logs" && <LogsView logs={status.logs} />}
              {activeView === "settings" && (
                <SettingsView gateway={gateway} onChanged={refreshGateway} />
              )}
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

function Overview({
  copied,
  gateway,
  logs,
  metrics,
  onCopy,
  onOpenSettings,
  startedTime,
}: {
  copied: boolean;
  gateway: GatewayStatus;
  logs: RequestLog[];
  metrics: GatewayMetrics;
  onCopy: () => void;
  onOpenSettings: () => void;
  startedTime: string;
}) {
  const ModeIcon = gateway.deploymentMode === "public" ? Globe2 : Cable;

  return (
    <div className="overview-layout">
      <section className={`deployment-rail ${gateway.deploymentMode}`}>
        <div className="deployment-mode">
          <ModeIcon size={18} />
          <div>
            <span className="field-label">当前部署</span>
            <strong>{deploymentLabel(gateway.deploymentMode)}</strong>
          </div>
        </div>
        <div className="contract-track" aria-label="公网与本地共享同一个接口契约">
          <span>赛前公网</span>
          <i />
          <code>/v1</code>
          <i />
          <span>赛中本地</span>
        </div>
      </section>

      <section className="ingress-strip" aria-label="内网与外网访问端口">
        <IngressEndpoint
          endpoint={gateway.internalEndpoint}
          icon={Cable}
          label="内网端口"
        />
        <IngressEndpoint
          endpoint={gateway.externalEndpoint}
          icon={Globe2}
          label="外网端口"
        />
      </section>

      <section className="gateway-rail">
        <div className="gateway-identity">
          <div className={`gateway-icon ${gateway.state}`}>
            <Network size={22} />
          </div>
          <div>
            <span className="field-label">OPENAI 兼容地址</span>
            <strong>{gateway.apiBase}</strong>
          </div>
        </div>
        <div className="gateway-rail-actions">
          <span className="rail-meta">启动时间 {startedTime}</span>
          <button className="copy-button" onClick={onCopy} type="button">
            {copied ? <Check size={16} /> : <Clipboard size={16} />}
            {copied ? "已复制" : "复制地址"}
          </button>
        </div>
      </section>

      <section className="metric-strip" aria-label="运行指标">
        <Metric label="已转发请求" value={String(metrics.requests)} detail="自本次进程启动" />
        <Metric label="活跃凭证" value={String(metrics.activeClients)} detail="内存统计，不含密钥原文" />
        <Metric label="失败请求" value={String(metrics.failedRequests)} detail="上游返回或连接失败" />
        <Metric
          label="成功率"
          value={metrics.successRate === null ? "--" : `${metrics.successRate}%`}
          detail="HTTP 2xx 与 3xx"
        />
      </section>

      <div className="overview-columns">
        <section className="workspace-panel setup-panel">
          <div className="panel-heading">
            <div>
              <span className="field-label">READINESS</span>
              <h2>启动检查</h2>
            </div>
            <button className="text-button" onClick={onOpenSettings} type="button">
              查看设置
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="check-list">
            <CheckRow
              icon={ServerCog}
              label="模型 API 服务"
              state={gateway.serviceEnabled ? "接受请求" : "已停止"}
              tone={
                !gateway.serviceStateFileValid
                  ? "danger"
                  : gateway.serviceEnabled
                    ? "success"
                    : "neutral"
              }
            />
            <CheckRow
              icon={gateway.operationMode === "competition" ? Trophy : FlaskConical}
              label="运行模式"
              state={operationModeCopy[gateway.operationMode].label}
              tone={
                !gateway.operationModeStateFileValid
                  ? "danger"
                  : gateway.operationMode === "competition"
                    ? "success"
                    : "neutral"
              }
            />
            <CheckRow
              icon={Router}
              label="上游供应商"
              state={gateway.providerConfigured ? "已配置" : "未配置"}
              tone={gateway.providerConfigured ? "success" : "warning"}
            />
            <CheckRow
              icon={KeyRound}
              label="选手访问鉴权"
              state={gateway.clientAuthConfigured ? "已启用" : "未配置"}
              tone={gateway.clientAuthConfigured ? "success" : "warning"}
            />
          </div>
        </section>

        <section className="workspace-panel activity-panel">
          <div className="panel-heading">
            <div>
              <span className="field-label">LATEST TRAFFIC</span>
              <h2>最近调用</h2>
            </div>
            <Activity size={18} className="panel-icon" />
          </div>
          <RecentActivity logs={logs.slice(0, 4)} />
        </section>
      </div>
    </div>
  );
}

function IngressEndpoint({
  endpoint,
  icon: Icon,
  label,
}: {
  endpoint: GatewayIngressEndpoint;
  icon: typeof Cable;
  label: string;
}) {
  return (
    <div className={`ingress-endpoint ${endpoint.configured ? "configured" : "closed"}`}>
      <span className="ingress-icon"><Icon size={18} /></span>
      <span className="ingress-copy">
        <span className="field-label">{label}</span>
        <strong>{endpoint.port ?? "未开放"}</strong>
      </span>
      <span className="ingress-address" title={endpoint.apiBase ?? "未配置公网入站地址"}>
        {endpoint.apiBase ?? "未配置公网入站地址"}
      </span>
      <span className={`check-state ${endpoint.configured ? "success" : "neutral"}`}>
        {endpoint.configured ? "已配置" : "未开放"}
      </span>
    </div>
  );
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="metric-cell">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}

function CheckRow({
  icon: Icon,
  label,
  state,
  tone,
}: {
  icon: typeof ServerCog;
  label: string;
  state: string;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className="check-row">
      <div className="check-name">
        <Icon size={18} />
        <span>{label}</span>
      </div>
      <span className={`check-state ${tone}`}>{state}</span>
    </div>
  );
}

function RecentActivity({ logs }: { logs: RequestLog[] }) {
  if (logs.length === 0) {
    return (
      <div className="empty-state compact">
        <div className="empty-rule" />
        <strong>暂无调用记录</strong>
        <span>首个网关请求会显示在这里</span>
      </div>
    );
  }

  return (
    <div className="gateway-activity-list">
      {logs.map((log) => (
        <div className="gateway-activity-row" key={log.id}>
          <span className={log.status < 400 ? "result-dot success" : "result-dot danger"} />
          <div>
            <strong>{log.model}</strong>
            <span>{log.client} · {log.durationMs} ms</span>
          </div>
          <code>{log.status}</code>
        </div>
      ))}
    </div>
  );
}

function ModelsView({ gateway }: { gateway: GatewayStatus }) {
  const families = [
    { id: "deepseek" as const, name: "DeepSeek", note: "官方主路由 / 硅基流动备用" },
    { id: "qwen" as const, name: "Qwen", note: "阿里云百炼主路由 / 硅基流动备用" },
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
    siliconflow: "硅基流动",
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

function ModeControl({
  gateway,
  onChanged,
}: {
  gateway: GatewayStatus;
  onChanged: () => Promise<void>;
}) {
  const [pendingMode, setPendingMode] = useState<OperationMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeMode = gateway.operationMode;

  async function applyMode(nextMode: OperationMode) {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/mode", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: nextMode }),
      });
      if (response.status === 401) {
        window.dispatchEvent(new Event("modelmux-admin-unauthorized"));
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `运行模式接口返回 HTTP ${response.status}`);
      }
      setPendingMode(null);
      setNotice(`已切换到${operationModeCopy[nextMode].label}`);
      await onChanged();
    } catch (updateError) {
      setError(
        updateError instanceof Error ? updateError.message : String(updateError),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <section className={`workspace-panel mode-control ${activeMode}`}>
        <div className="service-control-heading">
          <div className={`service-control-icon ${activeMode}`}>
            {activeMode === "competition" ? <Trophy size={21} /> : <FlaskConical size={21} />}
          </div>
          <div>
            <span className="field-label">OPERATION MODE</span>
            <h2>运行模式</h2>
            <p>用于区分赛前演练与正式比赛的现场展示状态。</p>
          </div>
          <span className={`service-state-badge ${activeMode}`}>
            <span />
            {operationModeCopy[activeMode].label}
          </span>
        </div>

        <div className="service-control-body">
          {!gateway.operationModeStateFileValid && (
            <div className="service-warning" role="alert">
              <CircleAlert size={17} />
              <span>运行模式状态文件无效，系统已按测试模式运行。重新选择模式可修复状态文件。</span>
            </div>
          )}
          {error && (
            <div className="service-warning" role="alert">
              <CircleAlert size={17} />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="service-notice" role="status">
              <Check size={17} />
              <span>{notice}</span>
            </div>
          )}

          <div className="mode-choice-grid">
            {(["test", "competition"] as const).map((candidate) => {
              const ModeIcon = candidate === "competition" ? Trophy : FlaskConical;
              const active = candidate === activeMode;
              return (
                <button
                  aria-pressed={active}
                  className={`mode-choice ${candidate}${active ? " active" : ""}`}
                  disabled={saving || active}
                  key={candidate}
                  onClick={() => {
                    setNotice(null);
                    setPendingMode(candidate);
                  }}
                  type="button"
                >
                  <span className="mode-choice-icon"><ModeIcon size={19} /></span>
                  <strong>{operationModeCopy[candidate].label}</strong>
                  <small>{operationModeCopy[candidate].summary}</small>
                  <span className="mode-choice-state">{active ? "当前模式" : "切换到此模式"}</span>
                </button>
              );
            })}
          </div>

          <div className="mode-effect-list">
            <ModeEffect label="模型 API" value="只校验凭证并转发，不受运行模式影响" />
            <ModeEffect label="考务工作台与选手端" value={`同步显示「${operationModeCopy[activeMode].label}」状态`} />
          </div>
        </div>

        <div className="service-control-footer">
          <span>{deploymentLabel(gateway.deploymentMode)}</span>
          <span>
            {gateway.operationModeUpdatedAt
              ? `上次变更 ${formatDate(Date.parse(gateway.operationModeUpdatedAt))}`
              : "尚未手动变更，使用默认测试模式"}
          </span>
        </div>
      </section>

      {pendingMode && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-describedby="switch-mode-description"
            aria-labelledby="switch-mode-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-icon">
              {pendingMode === "competition" ? <Trophy size={20} /> : <FlaskConical size={20} />}
            </div>
            <h2 id="switch-mode-title">切换到{operationModeCopy[pendingMode].label}？</h2>
            <p id="switch-mode-description">
              考务工作台、选手端和比赛大屏会立即显示新的运行模式。
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => setPendingMode(null)}
                type="button"
              >
                取消
              </button>
              <button
                className={pendingMode === "competition" ? "danger-action" : "primary-action"}
                disabled={saving}
                onClick={() => void applyMode(pendingMode)}
                type="button"
              >
                {saving
                  ? <RefreshCw className="spinning" size={15} />
                  : pendingMode === "competition" ? <Trophy size={15} /> : <FlaskConical size={15} />}
                切换模式
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function ModeEffect({ label, value }: { label: string; value: string }) {
  return (
    <div className="mode-effect">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SettingsView({
  gateway,
  onChanged,
}: {
  gateway: GatewayStatus;
  onChanged: () => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function updateService(enabled: boolean) {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch("/api/admin/service", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (response.status === 401) {
        window.dispatchEvent(new Event("modelmux-admin-unauthorized"));
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      if (!response.ok) {
        throw new Error(payload?.error ?? `服务状态接口返回 HTTP ${response.status}`);
      }
      setConfirmStop(false);
      await onChanged();
    } catch (updateError) {
      setSaveError(
        updateError instanceof Error ? updateError.message : String(updateError),
      );
    } finally {
      setSaving(false);
    }
  }

  const serviceStatus = gateway.serviceEnabled ? "对外开放" : "已停止";

  return (
    <>
      <ModeControl gateway={gateway} onChanged={onChanged} />

      <section className={`workspace-panel service-control ${gateway.state}`}>
        <div className="service-control-heading">
          <div className={`service-control-icon ${gateway.serviceEnabled ? "enabled" : "disabled"}`}>
            <Power size={21} />
          </div>
          <div>
            <span className="field-label">PUBLIC API CONTROL</span>
            <h2>模型 API 服务</h2>
            <p>控制公网和内网入口是否接受新的模型请求。</p>
          </div>
          <span className={`service-state-badge ${gateway.serviceEnabled ? "enabled" : "disabled"}`}>
            <span />
            {serviceStatus}
          </span>
        </div>

        <div className="service-control-body">
          {!gateway.serviceStateFileValid && (
            <div className="service-warning" role="alert">
              <CircleAlert size={17} />
              <span>停服状态文件无效，网关已自动停止。重新开启可修复状态文件。</span>
            </div>
          )}
          {saveError && (
            <div className="service-warning" role="alert">
              <CircleAlert size={17} />
              <span>{saveError}</span>
            </div>
          )}

          <div className="service-switch-row">
            <div>
              <strong>接受模型请求</strong>
              <span>{gateway.serviceEnabled ? "OpenAI 兼容端点当前可用" : "模型端点当前返回 HTTP 503"}</span>
            </div>
            <button
              aria-checked={gateway.serviceEnabled}
              aria-label={gateway.serviceEnabled ? "停止模型 API 服务" : "开启模型 API 服务"}
              className={`service-toggle ${gateway.serviceEnabled ? "enabled" : "disabled"}`}
              disabled={saving}
              onClick={() => {
                if (gateway.serviceEnabled) setConfirmStop(true);
                else void updateService(true);
              }}
              role="switch"
              type="button"
            >
              <span />
            </button>
          </div>

          <div className="service-endpoints" aria-label="模型 API 端点状态">
            {[
              "/v1/models",
              "/v1/chat/completions",
            ].map((endpoint) => (
              <div className="service-endpoint" key={endpoint}>
                <code>{endpoint}</code>
                <span className={gateway.serviceEnabled ? "available" : "stopped"}>
                  {gateway.serviceEnabled ? "开放" : "停止"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="service-control-footer">
          <span>{deploymentLabel(gateway.deploymentMode)}</span>
          <span>
            {gateway.serviceStateUpdatedAt
              ? `上次变更 ${formatDate(Date.parse(gateway.serviceStateUpdatedAt))}`
              : "尚未手动变更"}
          </span>
        </div>
      </section>

      {confirmStop && (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-describedby="stop-service-description"
            aria-labelledby="stop-service-title"
            aria-modal="true"
            className="confirm-dialog"
            role="dialog"
          >
            <div className="confirm-dialog-icon">
              <Power size={20} />
            </div>
            <h2 id="stop-service-title">停止模型 API 服务？</h2>
            <p id="stop-service-description">
              新的模型请求将立即返回 HTTP 503。管理员后台保持在线，服务重启后仍维持停止状态。
            </p>
            <div className="confirm-dialog-actions">
              <button
                className="secondary-action"
                disabled={saving}
                onClick={() => setConfirmStop(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="danger-action"
                disabled={saving}
                onClick={() => void updateService(false)}
                type="button"
              >
                {saving ? <RefreshCw className="spinning" size={15} /> : <Power size={15} />}
                停止服务
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
