import type { CompetitionRole } from "./types";

export type ContestantView = "questions" | "api-docs";
export type JudgeView = "questions" | "answers";

export const contestantViewRoutes: Record<ContestantView, string> = {
  questions: "/contestant/questions",
  "api-docs": "/contestant/api-docs",
};

export const judgeViewRoutes: Record<JudgeView, string> = {
  questions: "/judge/questions",
  answers: "/judge/answers",
};

export function isContestantView(value: string): value is ContestantView {
  return value === "questions" || value === "api-docs";
}

export function isJudgeView(value: string): value is JudgeView {
  return value === "questions" || value === "answers";
}

export function contestantViewFromPath(pathname: string): ContestantView {
  return pathname === contestantViewRoutes["api-docs"] ? "api-docs" : "questions";
}

export function judgeViewFromPath(pathname: string): JudgeView {
  return pathname === judgeViewRoutes.answers ? "answers" : "questions";
}

export const roleHomeRoutes: Record<CompetitionRole, string> = {
  judge: judgeViewRoutes.questions,
  contestant: contestantViewRoutes.questions,
};

const rolePathPrefixes: Record<CompetitionRole, string> = {
  judge: "/judge",
  contestant: "/contestant",
};

export function roleFromPath(pathname: string): CompetitionRole | null {
  const path = pathname.split(/[?#]/)[0];
  for (const role of ["judge", "contestant"] as const) {
    const prefix = rolePathPrefixes[role];
    if (path === prefix || path.startsWith(`${prefix}/`)) return role;
  }
  return null;
}

/**
 * 登录成功后的落地页。?next= 来自地址栏，只接受"本站内、且属于该角色"的路径，
 * 其余一律回落到角色首页，避免被当成开放重定向跳去外站或跳进另一个角色的页面。
 */
export function loginRedirectTarget(
  role: CompetitionRole,
  next: string | null | undefined,
): string {
  if (!next || !next.startsWith("/")) return roleHomeRoutes[role];
  return roleFromPath(next) === role ? next : roleHomeRoutes[role];
}
