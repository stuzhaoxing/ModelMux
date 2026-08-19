import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { clearAdminSessionCookie, requireAdmin } from "@/lib/admin/auth";
import { requireSameOrigin } from "@/lib/competition/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const response = NextResponse.json({ ok: true });
  clearAdminSessionCookie(response);
  return response;
}
