import { notFound, redirect } from "next/navigation";

import { contestantViewRoutes, isContestantView, roleHomeRoutes } from "@/lib/competition/navigation";
import { sessionUserFromCookies } from "@/lib/competition/server-session";
import ContestantApp from "@/src/competition/ContestantApp";

export const dynamic = "force-dynamic";

export default async function ContestantViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (view === "playground") redirect("/contestant/api-docs");
  if (!isContestantView(view)) notFound();
  const user = await sessionUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(contestantViewRoutes[view])}`);
  // 全站只有一个会话，评委登录着就不可能同时是选手，直接把他送回自己的工作台。
  if (user.role !== "contestant") redirect(roleHomeRoutes[user.role]);
  return <ContestantApp user={user} />;
}
