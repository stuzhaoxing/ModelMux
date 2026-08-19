import { describe, expect, it } from "vitest";

import {
  adminViewFromPathname,
  adminViewPaths,
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
    expect(isRoutedAdminViewId("access")).toBe(false);
    expect(isRoutedAdminViewId("overview")).toBe(false);
    expect(isRoutedAdminViewId("unknown")).toBe(false);
  });
});
