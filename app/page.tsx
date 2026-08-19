import { redirect } from "next/navigation";

import { roleHomeRoutes } from "@/lib/competition/navigation";
import { sessionUserFromCookies } from "@/lib/competition/server-session";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await sessionUserFromCookies();
  redirect(user ? roleHomeRoutes[user.role] : "/login");
}
