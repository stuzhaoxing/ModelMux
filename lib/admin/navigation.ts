export const adminViewPaths = {
  overview: "/admin",
  competition: "/admin/competition",
  questions: "/admin/questions",
  answers: "/admin/answers",
  accounts: "/admin/accounts",
  models: "/admin/models",
  logs: "/admin/logs",
  settings: "/admin/settings",
} as const;

export type AdminViewId = keyof typeof adminViewPaths;
export type AdminJudgeView = "dashboard" | "questions" | "answers";

export const adminJudgeViewPaths: Record<AdminJudgeView, string> = {
  dashboard: adminViewPaths.competition,
  questions: adminViewPaths.questions,
  answers: adminViewPaths.answers,
};

const routedAdminViewIds = [
  "competition",
  "questions",
  "answers",
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

export function isAdminJudgeViewId(view: AdminViewId): boolean {
  return view === "competition" || view === "questions" || view === "answers";
}

export function adminJudgeViewFromPathname(pathname: string): AdminJudgeView {
  if (pathname === adminJudgeViewPaths.dashboard) return "dashboard";
  return pathname === adminJudgeViewPaths.answers ? "answers" : "questions";
}
