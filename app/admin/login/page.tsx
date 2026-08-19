import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { adminSessionCookieName, verifyAdminSessionToken } from "@/lib/admin/auth";
import AdminLogin from "@/src/admin/AdminLogin";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage() {
  const token = (await cookies()).get(adminSessionCookieName)?.value;
  if (verifyAdminSessionToken(token)) redirect("/admin");
  return <AdminLogin />;
}
