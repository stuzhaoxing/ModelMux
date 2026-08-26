"use client";

import {
  BookOpen,
  FileEdit,
  LogOut,
  Radio,
  ShieldCheck,
} from "lucide-react";

import { SYSTEM_NAME } from "@/lib/branding";
import {
  contestantViewRoutes,
  type ContestantView,
} from "@/lib/competition/navigation";
import type { SessionUser } from "@/lib/competition/types";
import type { OperationMode } from "@/lib/gateway/operation-mode";
import { OperationModeBanner } from "./OperationModeBanner";

export function PortalFrame({
  role,
  user,
  online,
  mode,
  onLogout,
  activeView,
  onViewChange,
  children,
}: {
  role: "judge" | "contestant";
  user: SessionUser;
  online: boolean;
  mode: OperationMode | null;
  onLogout: () => void;
  activeView?: ContestantView;
  onViewChange?: (view: ContestantView) => void;
  children: React.ReactNode;
}) {
  return (
    <div className={`competition-portal ${role} mode-${mode ?? "unknown"}`}>
      <OperationModeBanner mode={mode} />
      <header className="competition-header">
        <a className="competition-brand" href={role === "judge" ? "/judge/dashboard" : "/contestant/questions"}>
          <span className="competition-brand-mark"><span /><span /><span /></span>
          <span><strong>{SYSTEM_NAME}</strong><small>{role === "judge" ? "评委工作台" : "选手答题端"}</small></span>
        </a>
        <div className="competition-identity">
          <span className={`live-state ${online ? "online" : "offline"}`}>
            <Radio size={14} />{online ? "实时连接" : "正在重连"}
          </span>
          <span className="identity-name">
            <ShieldCheck size={15} />
            <span>{user.displayName}<small>{user.username}</small></span>
          </span>
          <button className="competition-icon-button" type="button" onClick={onLogout}><LogOut size={15} />退出登录</button>
        </div>
      </header>
      {role === "contestant" && activeView && onViewChange && (
        <nav className="contestant-primary-nav" aria-label="选手功能菜单">
          <a href={contestantViewRoutes.questions} className={activeView === "questions" ? "active" : ""} aria-current={activeView === "questions" ? "page" : undefined} onClick={(event) => { event.preventDefault(); onViewChange("questions"); }}><FileEdit />答题工作台</a>
          <a href={contestantViewRoutes["api-docs"]} className={activeView === "api-docs" ? "active" : ""} aria-current={activeView === "api-docs" ? "page" : undefined} onClick={(event) => { event.preventDefault(); onViewChange("api-docs"); }}><BookOpen />API 技术文档</a>
        </nav>
      )}
      {children}
    </div>
  );
}
