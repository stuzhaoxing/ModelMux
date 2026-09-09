import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { updateCompetitionUserSchema } from "@/lib/competition/accounts";
import { competitionError, parseJson, requireSameOrigin } from "@/lib/competition/http";
import { deleteUser, updateUser } from "@/lib/competition/repository";

export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId < 1) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  try {
    const changed = await updateUser({ id: userId, ...(await parseJson(request, updateCompetitionUserSchema)) });
    return changed ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "账号不存在或没有变更" }, { status: 404 });
  } catch (error) {
    return competitionError(error);
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isSafeInteger(userId) || userId < 1) return NextResponse.json({ error: "账号不存在" }, { status: 404 });
  try {
    const deleted = await deleteUser(userId);
    return deleted
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: "账号不存在" }, { status: 404 });
  } catch (error) {
    return competitionError(error);
  }
}
