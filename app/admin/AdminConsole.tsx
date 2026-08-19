import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { adminSessionCookieName, verifyAdminSessionToken } from "@/lib/admin/auth";
import App from "@/src/App";

export default async function AdminConsole() {
  const token = (await cookies()).get(adminSessionCookieName)?.value;
  const session = verifyAdminSessionToken(token);
  if (!session) redirect("/admin/login");
  return <App />;
}
