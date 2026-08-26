import { describe, expect, it } from "vitest";

import {
  contestantViewFromPath,
  contestantViewRoutes,
  isContestantView,
  isJudgeView,
  judgeViewFromPath,
  judgeViewRoutes,
  loginRedirectTarget,
  roleFromPath,
  roleHomeRoutes,
} from "./navigation";

describe("competition portal navigation", () => {
  it("maps contestant routes to their visible menu", () => {
    expect(contestantViewRoutes.questions).toBe("/contestant/questions");
    expect(contestantViewRoutes["api-docs"]).toBe("/contestant/api-docs");
    expect(contestantViewFromPath("/contestant/api-docs")).toBe("api-docs");
    expect(contestantViewFromPath("/contestant/questions")).toBe("questions");
    expect(isContestantView("api-docs")).toBe(true);
    expect(isContestantView("playground")).toBe(false);
    expect(isContestantView("unknown")).toBe(false);
  });

  it("maps judge routes to their visible tab", () => {
    expect(judgeViewRoutes.dashboard).toBe("/judge/dashboard");
    expect(judgeViewRoutes.questions).toBe("/judge/questions");
    expect(judgeViewRoutes.answers).toBe("/judge/answers");
    expect(judgeViewFromPath("/judge/dashboard")).toBe("dashboard");
    expect(judgeViewFromPath("/judge/answers")).toBe("answers");
    expect(judgeViewFromPath("/judge/questions")).toBe("questions");
    expect(isJudgeView("dashboard")).toBe(true);
    expect(isJudgeView("answers")).toBe(true);
    expect(isJudgeView("unknown")).toBe(false);
  });

  it("reads the role a portal path belongs to", () => {
    expect(roleFromPath("/judge/answers")).toBe("judge");
    expect(roleFromPath("/contestant/questions?tab=1")).toBe("contestant");
    expect(roleFromPath("/contestant")).toBe("contestant");
    expect(roleFromPath("/judgement/questions")).toBeNull();
    expect(roleFromPath("/admin")).toBeNull();
    expect(roleFromPath("/login")).toBeNull();
  });

  it("sends each role to its own home after login", () => {
    expect(roleHomeRoutes.judge).toBe("/judge/dashboard");
    expect(roleHomeRoutes.contestant).toBe("/contestant/questions");
    expect(loginRedirectTarget("judge", null)).toBe("/judge/dashboard");
    expect(loginRedirectTarget("contestant", undefined)).toBe("/contestant/questions");
    expect(loginRedirectTarget("contestant", "/contestant/api-docs")).toBe("/contestant/api-docs");
    expect(loginRedirectTarget("judge", "/judge/answers?q=2")).toBe("/judge/answers?q=2");
  });

  it("refuses a next target that leaves the site or the role", () => {
    expect(loginRedirectTarget("contestant", "https://evil.example/x")).toBe("/contestant/questions");
    expect(loginRedirectTarget("contestant", "//evil.example/x")).toBe("/contestant/questions");
    expect(loginRedirectTarget("contestant", "/\\evil.example")).toBe("/contestant/questions");
    expect(loginRedirectTarget("contestant", "/judge/answers")).toBe("/contestant/questions");
    expect(loginRedirectTarget("judge", "/admin")).toBe("/judge/dashboard");
    expect(loginRedirectTarget("judge", "/contestant/questions")).toBe("/judge/dashboard");
  });
});
