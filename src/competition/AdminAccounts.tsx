"use client";

import {
  Check,
  Copy,
  Download,
  LoaderCircle,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  Sparkles,
  Trash2,
  UserCog,
  UsersRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CompetitionRole, CompetitionUser } from "@/lib/competition/types";
import { apiRequest, formatCompetitionTime } from "./api";

export default function AdminAccounts() {
  const [users, setUsers] = useState<CompetitionUser[]>([]);
  const [apiBase, setApiBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [role, setRole] = useState<CompetitionRole>("contestant");
  const [activeRole, setActiveRole] = useState<CompetitionRole>("contestant");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState("");
  const [generatedCredentials, setGeneratedCredentials] = useState<{
    role: CompetitionRole;
    username: string;
    displayName: string;
    password: string;
    apiKey: string | null;
    requestQuota: number;
  } | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      const result = await apiRequest<{ users: CompetitionUser[]; apiBase: string }>("/api/admin/competition/users");
      setUsers(result.users);
      setApiBase(result.apiBase);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "账号读取失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    apiRequest<{ users: CompetitionUser[]; apiBase: string }>("/api/admin/competition/users")
      .then((result) => { setUsers(result.users); setApiBase(result.apiBase); setError(null); })
      .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "账号读取失败"))
      .finally(() => setLoading(false));
  }, []);

  async function createAccount(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest("/api/admin/competition/users", {
        method: "POST",
        body: JSON.stringify({ role, username, displayName, password }),
      });
      setUsername("");
      setDisplayName("");
      setPassword("");
      setGeneratedCredentials(null);
      await loadUsers();
      setActiveRole(role);
      setNotice(role === "judge" ? "评委账号已创建" : "选手账号已创建");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "账号创建失败");
    } finally {
      setPending(false);
    }
  }

  async function generateAccount() {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ user: { role: CompetitionRole; username: string; displayName: string; password: string; apiKey: string | null; requestQuota: number }; apiBase: string }>("/api/admin/competition/users", {
        method: "POST",
        body: JSON.stringify({ role, autoGenerate: true }),
      });
      setGeneratedCredentials(result.user);
      setApiBase(result.apiBase);
      setActiveRole(role);
      await loadUsers();
      setNotice(`${role === "judge" ? "评委" : "选手"}账号已自动生成，请及时复制登录信息`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "账号生成失败");
    } finally {
      setPending(false);
    }
  }

  async function updateAccount(user: CompetitionUser, changes: { active?: boolean; displayName?: string }, successMessage: string): Promise<boolean> {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/competition/users/${user.id}`, { method: "PATCH", body: JSON.stringify(changes) });
      await loadUsers();
      setNotice(successMessage);
      return true;
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "账号更新失败");
      return false;
    } finally {
      setPending(false);
    }
  }

  function beginEdit(user: CompetitionUser) {
    setEditingUserId(user.id);
    setEditingDisplayName(user.displayName);
    setError(null);
    setNotice(null);
  }

  async function saveDisplayName(user: CompetitionUser) {
    const nextName = editingDisplayName.trim();
    if (!nextName) {
      setError("显示姓名不能为空");
      return;
    }
    if (await updateAccount(user, { displayName: nextName }, "显示姓名已更新")) setEditingUserId(null);
  }

  async function copyAccount(user: Pick<CompetitionUser, "role" | "username" | "password" | "displayName" | "apiKey" | "requestQuota">) {
    if (!user.password) {
      setError("该账号没有可复制的密码，请重新生成账号");
      return;
    }
    const loginUrl = `${window.location.origin}${user.role === "judge" ? "/judge/questions" : "/contestant/questions"}`;
    const content = [
      `登录地址：${loginUrl}`,
      `账号：${user.username}`,
      `密码：${user.password}`,
      `显示姓名：${user.displayName}`,
      ...(user.role === "contestant" && user.apiKey
        ? [
            `API URL：${apiBase ?? `${window.location.origin}/v1`}`,
            `API Key：${user.apiKey}`,
            `请求额度：${user.requestQuota}`,
          ]
        : []),
    ].join("\n");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(content);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = content;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setError(null);
      setNotice(user.role === "contestant" ? "登录信息和 API 调用信息已复制" : "登录地址、账号和密码已复制");
    } catch {
      setError("复制失败，请手动复制账号信息");
    }
  }

  async function deleteAccount(user: CompetitionUser) {
    const confirmed = window.confirm(
      `确认删除账号“${user.displayName}”（${user.username}）？\n\n账号将立即停用并从列表隐藏，历史答题数据会保留。`,
    );
    if (!confirmed) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await apiRequest(`/api/admin/competition/users/${user.id}`, { method: "DELETE" });
      await loadUsers();
      setNotice("账号已删除，历史数据已保留");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "账号删除失败");
    } finally {
      setPending(false);
    }
  }

  const judges = users.filter((user) => user.role === "judge");
  const contestants = users.filter((user) => user.role === "contestant");
  const visibleUsers = activeRole === "judge" ? judges : contestants;
  const activeRoleName = activeRole === "judge" ? "评委" : "选手";

  return (
    <div className="account-management">
      <section className="workspace-panel account-create-panel">
        <div className="panel-heading">
          <div><span className="field-label">ACCOUNT ISSUANCE</span><h2>生成账号</h2></div>
          <UserCog size={19} className="panel-icon" />
        </div>
        <form className="account-form" onSubmit={createAccount}>
          <div className="role-segment" role="group" aria-label="账号角色">
            <button type="button" className={role === "contestant" ? "active" : ""} onClick={() => setRole("contestant")}><UsersRound />选手</button>
            <button type="button" className={role === "judge" ? "active" : ""} onClick={() => setRole("judge")}><UserCog />评委</button>
          </div>
          <button className="account-auto-button" disabled={pending} type="button" onClick={() => void generateAccount()}><Sparkles />自动生成{role === "judge" ? "评委" : "选手"}账号</button>
          <label>登录账号<input required minLength={2} maxLength={64} pattern="[a-zA-Z0-9._-]+" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={role === "contestant" ? "例如 contestant01" : "例如 judge01"} /></label>
          <label>显示姓名<input required maxLength={100} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="现场显示的姓名" /></label>
          <label>初始密码<input required minLength={8} maxLength={200} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label>
          <button className="account-create-button" disabled={pending} type="submit">{pending ? <LoaderCircle className="spinning" /> : <Plus />}{pending ? "正在创建" : "创建账号"}</button>
        </form>
        {generatedCredentials && <div className="generated-credentials">
          <div><strong>本次生成的登录信息</strong><span>密码不会再次生成，请先复制保存</span></div>
          <code>{generatedCredentials.username} / {generatedCredentials.password}</code>
          {generatedCredentials.apiKey && <code>{generatedCredentials.apiKey} · {generatedCredentials.requestQuota} 次</code>}
          <button type="button" className="secondary-action" onClick={() => void copyAccount(generatedCredentials)}><Copy />复制登录信息</button>
        </div>}
        <div className="portal-links"><a href="/judge/questions" target="_blank">评委登录入口</a><a href="/contestant/questions" target="_blank">选手登录入口</a></div>
      </section>

      <section className="workspace-panel account-list-panel">
        <div className="panel-heading table-heading">
          <div><span className="field-label">COMPETITION USERS</span><h2>账号列表</h2></div>
          <div className="account-heading-actions">
            <a className="account-export-button" href={`/api/admin/competition/users/export?role=${activeRole}`} download><Download />导出{activeRoleName} Excel</a>
            <button type="button" className="icon-button" title="刷新账号" aria-label="刷新账号" onClick={() => void loadUsers()}><RefreshCw className={loading ? "spinning" : ""} size={17} /></button>
          </div>
        </div>
        {(error || notice) && <div className={`account-message ${error ? "error" : "success"}`}>{error ?? notice}</div>}
        <div className="account-tabs" role="tablist" aria-label="账号角色">
          <button type="button" role="tab" aria-selected={activeRole === "contestant"} className={activeRole === "contestant" ? "active" : ""} onClick={() => setActiveRole("contestant")}><UsersRound />选手 <strong>{contestants.length}</strong></button>
          <button type="button" role="tab" aria-selected={activeRole === "judge"} className={activeRole === "judge" ? "active" : ""} onClick={() => setActiveRole("judge")}><UserCog />评委 <strong>{judges.length}</strong></button>
          <span><Check />当前启用 <strong>{visibleUsers.filter((user) => user.active).length}</strong></span>
        </div>
        <div className="account-table">
          <div className="account-row account-table-header"><span>名字</span><span>账号</span><span>密码</span><span>最后登录</span><span>状态</span><span>操作</span></div>
          {visibleUsers.map((user) => (
            <div className="account-row" key={user.id}>
              <span className="account-name-cell">{editingUserId === user.id ? <input className="account-name-input" autoFocus maxLength={100} value={editingDisplayName} onChange={(event) => setEditingDisplayName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveDisplayName(user); if (event.key === "Escape") setEditingUserId(null); }} /> : <strong>{user.displayName}</strong>}</span>
              <span className="account-credential account-identity-credential">{user.username}{user.role === "contestant" && <small>API 额度 {user.requestsUsed} / {user.requestQuota}</small>}</span>
              <span className={`account-credential ${user.password ? "" : "unavailable"}`}>{user.password ?? "历史账号无密码记录"}</span>
              <span className="account-time">{formatCompetitionTime(user.lastLoginAt)}</span>
              <span><i className={`account-state ${user.active ? "active" : "disabled"}`}>{user.active ? "启用" : "停用"}</i></span>
              <span className="account-actions">{editingUserId === user.id ? <><button type="button" title="保存显示姓名" aria-label="保存显示姓名" disabled={pending} onClick={() => void saveDisplayName(user)}><Check /></button><button type="button" title="取消编辑" aria-label="取消编辑" disabled={pending} onClick={() => setEditingUserId(null)}><X /></button></> : <><button type="button" title="编辑显示姓名" aria-label={`编辑 ${user.displayName} 的显示姓名`} disabled={pending} onClick={() => beginEdit(user)}><Pencil /></button><button type="button" title="复制登录信息" aria-label={`复制 ${user.displayName} 的登录信息`} disabled={pending || !user.password} onClick={() => void copyAccount(user)}><Copy /></button><button type="button" title={user.active ? "停用账号" : "启用账号"} aria-label={`${user.active ? "停用" : "启用"} ${user.displayName}`} disabled={pending} onClick={() => void updateAccount(user, { active: !user.active }, user.active ? "账号已停用" : "账号已启用")}><Power /></button><button type="button" title="删除账号" aria-label={`删除 ${user.displayName}`} disabled={pending} onClick={() => void deleteAccount(user)}><Trash2 /></button></>}</span>
            </div>
          ))}
          {visibleUsers.length === 0 && !loading && <div className="account-empty">{activeRole === "judge" ? <UserCog /> : <UsersRound />}<strong>还没有{activeRoleName}账号</strong><span>先从左侧生成{activeRoleName}账号</span></div>}
        </div>
      </section>
    </div>
  );
}
