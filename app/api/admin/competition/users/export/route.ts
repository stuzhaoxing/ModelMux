import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { accountExportFilename, buildAccountWorkbook } from "@/lib/competition/account-export";
import { competitionError } from "@/lib/competition/http";
import { listUsers } from "@/lib/competition/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const admin = requireAdmin(request);
  if (admin instanceof NextResponse) return admin;

  const role = request.nextUrl.searchParams.get("role");
  if (role !== "contestant") {
    return NextResponse.json({ error: "账号角色无效" }, { status: 400 });
  }

  try {
    const body = await buildAccountWorkbook(await listUsers(), role);
    const filename = encodeURIComponent(accountExportFilename(role));

    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      },
    });
  } catch (error) {
    return competitionError(error);
  }
}
