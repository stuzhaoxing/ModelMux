import { NextRequest, NextResponse } from "next/server";

import { adminSessionCookieName } from "@/lib/admin/auth";

export function proxy(request: NextRequest): NextResponse {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/admin/login" || pathname === "/api/admin/auth/login") {
    return NextResponse.next();
  }
  if (request.cookies.has(adminSessionCookieName)) return NextResponse.next();
  if (pathname.startsWith("/api/admin/")) {
    return NextResponse.json({ error: "管理员登录状态已失效" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/admin/login", request.url));
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
