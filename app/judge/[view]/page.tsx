import { notFound, redirect } from "next/navigation";

import { isJudgeView, judgeViewRoutes, roleHomeRoutes } from "@/lib/competition/navigation";
import { sessionUserFromCookies } from "@/lib/competition/server-session";
import JudgeApp from "@/src/competition/JudgeApp";

export const dynamic = "force-dynamic";

export default async function JudgeViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!isJudgeView(view)) notFound();
  const user = await sessionUserFromCookies();
  if (!user) redirect(`/login?next=${encodeURIComponent(judgeViewRoutes[view])}`);
  if (user.role !== "judge") redirect(roleHomeRoutes[user.role]);
  return <JudgeApp user={user} />;
}
