export const adminViewPaths = {
  overview: "/admin",
  accounts: "/admin/accounts",
  models: "/admin/models",
  logs: "/admin/logs",
  settings: "/admin/settings",
} as const;

export type AdminViewId = keyof typeof adminViewPaths;

const routedAdminViewIds = [
  "accounts",
  "models",
  "logs",
  "settings",
] as const;

export function isRoutedAdminViewId(value: string): value is Exclude<AdminViewId, "overview"> {
  return routedAdminViewIds.some((viewId) => viewId === value);
}

export function adminViewFromPathname(pathname: string): AdminViewId {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  const match = Object.entries(adminViewPaths).find(
    ([, viewPath]) => viewPath === normalizedPathname,
  );
  return (match?.[0] as AdminViewId | undefined) ?? "overview";
}
