import { redirect } from "next/navigation";

import { loginRedirectTarget } from "@/lib/competition/navigation";
import { sessionUserFromCookies } from "@/lib/competition/server-session";
import UnifiedLogin from "@/src/competition/UnifiedLogin";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const user = await sessionUserFromCookies();
  if (user) redirect(loginRedirectTarget(user.role, next));
  return <UnifiedLogin next={next ?? null} />;
}
