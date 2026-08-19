import { notFound, permanentRedirect } from "next/navigation";

import AdminConsole from "@/app/admin/AdminConsole";
import { isRoutedAdminViewId } from "@/lib/admin/navigation";

export const dynamic = "force-dynamic";

export default async function AdminViewPage({
  params,
}: {
  params: Promise<{ view: string }>;
}) {
  const { view } = await params;
  if (view === "access") permanentRedirect("/admin");
  if (!isRoutedAdminViewId(view)) notFound();
  return <AdminConsole />;
}
