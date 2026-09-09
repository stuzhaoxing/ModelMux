"use client";

import { Archive, Download, LoaderCircle, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CompetitionArchiveSummary } from "@/lib/competition/archive-types";
import type { CompetitionControl } from "@/lib/competition/types";
import { apiRequest, formatCompetitionTime } from "./api";

const base = "/api/competition/judge/competition";
export function CompetitionResetPanel({ competition, disabled, onChanged, onPendingChange }: {
  competition: CompetitionControl;
  disabled: boolean;
  onChanged?: () => Promise<void>;
  onPendingChange?: (pending: boolean) => void;
}) {
  const [archives, setArchives] = useState<CompetitionArchiveSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [action, setAction] = useState<{ archive: CompetitionArchiveSummary | null; generation: number } | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const running = competition.state === "running";
  const phrase = action?.archive ? "恢复归档" : "归档并重置";
  const refresh = useCallback(async () => {
    const result = await apiRequest<{ archives: CompetitionArchiveSummary[] }>(`${base}/archives`);
    setArchives(result.archives);
  }, []);
  useEffect(() => {
    let active = true;
    void apiRequest<{ archives: CompetitionArchiveSummary[] }>(`${base}/archives`)
      .then((result) => { if (active) setArchives(result.archives); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "归档读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [competition.generation]);

  function choose(archive: CompetitionArchiveSummary | null) {
    setError(null);
    setNotice(null);
    setConfirmation("");
    setAction({ archive, generation: competition.generation ?? 0 });
  }
  async function execute() {
    if (!action || confirmation !== phrase || busy.current || running || disabled) return;
    busy.current = true;
    setPending(true);
    onPendingChange?.(true);
    setError(null);
    setNotice(null);
    try {
      const result = await apiRequest<{ archiveId: string }>(action.archive ? `${base}/archives/${action.archive.id}/restore` : `${base}/reset`, {
        method: "POST", body: JSON.stringify({ confirmation, generation: action.generation }),
      });
      setNotice(action.archive
        ? `归档已恢复，恢复前的数据已另存为归档 ${result.archiveId}。当前模式和计时设置保持不变。`
        : `已归档并重置，归档编号 ${result.archiveId}。现在可以重新测试，或在比赛当天开始正式比赛。`);
      setAction(null);
      setConfirmation("");
      const results = await Promise.allSettled([refresh(), onChanged?.()]);
      if (results.some((item) => item.status === "rejected")) setError("操作已完成，但页面刷新失败，请刷新页面查看最新状态。");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败，请刷新归档列表确认结果后重试");
    } finally {
      busy.current = false;
      setPending(false);
      onPendingChange?.(false);
    }
  }
  async function download(archive: CompetitionArchiveSummary) {
    try {
      const data = await apiRequest<unknown>(`${base}/archives/${archive.id}`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `competition-archive-${archive.id}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "归档下载失败"); }
  }
  return <section id="competition-reset-panel" className="dashboard-panel competition-reset-panel" aria-label="答题重置与历史归档">
    <div className="dashboard-panel-heading">
      <div><span>RESET & ARCHIVES</span><h2>答题重置与历史归档</h2></div>
      <button type="button" className="secondary-action danger" disabled={disabled || pending || running || loading} onClick={() => choose(null)}>
        {pending ? <LoaderCircle className="spinning" /> : <RotateCcw />}归档并重置
      </button>
    </div>
    <p>一次清理全部选手在测试题和正式赛题中的草稿、已提交答案、答题日志和 Token 统计，并回到测试状态。题目、选手账号、密码、API Key 和附件均保留。</p>
    <p className="reset-hint">{running ? "比赛中已锁定重置和恢复，请先结束比赛。" : "先完整归档，再清理；任一步失败都会回滚。历史归档可下载或恢复，恢复前也会自动备份当前数据。"}</p>
    {action && <form className="reset-confirmation" onSubmit={(event) => { event.preventDefault(); void execute(); }}>
      <strong>{action.archive ? `恢复 ${formatCompetitionTime(action.archive.createdAt)} 的归档（${action.archive.answerCount} 份答卷）` : "确认归档并清空所有选手的答题数据"}</strong>
      <p>{action.archive ? "将替换当前答卷和统计，保留当前题目、账号、模式和计时设置。" : "包含两个阶段的全部答题记录，不受上方测试题／正式赛题筛选影响。未保存到服务器的内容不在归档中。"}</p>
      <label>请输入“{phrase}”确认<input autoFocus value={confirmation} disabled={pending} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
      <div className="reset-actions">
        <button type="button" className="secondary-action" disabled={pending} onClick={() => setAction(null)}>取消</button>
        <button type="submit" className="primary-action danger" disabled={pending || disabled || running || confirmation !== phrase}>{pending ? "正在处理…" : phrase}</button>
      </div>
    </form>}
    {notice && <p className="workspace-message success" role="status">{notice}</p>}
    {error && <p className="workspace-message error" role="alert">{error}</p>}
    <div className="reset-archive-heading"><h3><Archive size={18} />历史归档</h3><button type="button" className="secondary-action" disabled={pending} onClick={() => { setError(null); void refresh().catch((cause) => setError(cause.message)); }}>刷新列表</button></div>
    <p className="reset-hint">下载内容为答卷原文、题目与选手快照、统计和附件索引（JSON）；附件文件保留在服务器。</p>
    {loading ? <p>正在读取归档…</p> : archives.length === 0 ? <p className="reset-hint">暂无归档。首次重置时会自动创建。</p> : <ul className="reset-archive-list">
      {archives.map((archive) => <li key={archive.id}>
        <div><strong>{formatCompetitionTime(archive.createdAt)} · {archive.reason === "reset" ? "重置前归档" : "恢复前备份"}</strong><p>{archive.contestantCount} 个选手账号 · {archive.answerCount} 份答卷（已提交 {archive.submittedCount}）</p><small>{archive.id}</small></div>
        <div className="reset-actions">
          <button type="button" className="secondary-action" onClick={() => void download(archive)}><Download />下载</button>
          <button type="button" className="secondary-action" disabled={disabled || pending || running} onClick={() => choose(archive)}><RotateCcw />恢复</button>
        </div>
      </li>)}
    </ul>}
  </section>;
}
