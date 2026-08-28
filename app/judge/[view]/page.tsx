import { notFound, permanentRedirect } from "next/navigation";

import { adminJudgeViewPaths } from "@/lib/admin/navigation";
import { isJudgeView } from "@/lib/competition/navigation";

export const dynamic = "force-dynamic";

export default async function JudgeViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (!isJudgeView(view)) notFound();
  permanentRedirect(adminJudgeViewPaths[view]);
}
