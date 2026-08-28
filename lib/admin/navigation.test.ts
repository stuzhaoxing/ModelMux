import { describe, expect, it } from "vitest";

import {
  adminViewFromPathname,
  adminJudgeViewFromPathname,
  adminJudgeViewPaths,
  adminViewPaths,
  isAdminJudgeViewId,
  isRoutedAdminViewId,
} from "./navigation";

describe("admin navigation", () => {
  it("maps every menu path back to its view", () => {
    for (const [viewId, pathname] of Object.entries(adminViewPaths)) {
      expect(adminViewFromPathname(pathname)).toBe(viewId);
    }
  });

  it("accepts trailing slashes and falls back safely", () => {
    expect(adminViewFromPathname("/admin/accounts/")).toBe("accounts");
    expect(adminViewFromPathname("/admin/unknown")).toBe("overview");
  });

  it("only accepts routable child views", () => {
    expect(isRoutedAdminViewId("models")).toBe(true);
    expect(isRoutedAdminViewId("competition")).toBe(true);
    expect(isRoutedAdminViewId("access")).toBe(false);
    expect(isRoutedAdminViewId("overview")).toBe(false);
    expect(isRoutedAdminViewId("unknown")).toBe(false);
  });

  it("maps the integrated judge tabs inside admin", () => {
    expect(adminJudgeViewPaths.dashboard).toBe("/admin/competition");
    expect(adminJudgeViewPaths.questions).toBe("/admin/questions");
    expect(adminJudgeViewPaths.answers).toBe("/admin/answers");
    expect(adminJudgeViewFromPathname("/admin/competition")).toBe("dashboard");
    expect(adminJudgeViewFromPathname("/admin/questions")).toBe("questions");
    expect(adminJudgeViewFromPathname("/admin/answers")).toBe("answers");
    expect(isAdminJudgeViewId("competition")).toBe(true);
    expect(isAdminJudgeViewId("answers")).toBe(true);
    expect(isAdminJudgeViewId("accounts")).toBe(false);
  });
});
