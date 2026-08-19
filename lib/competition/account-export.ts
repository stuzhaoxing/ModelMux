import ExcelJS from "exceljs";

import { SYSTEM_NAME } from "../branding";
import type { CompetitionRole, CompetitionUser } from "./types";

const roleNames: Record<CompetitionRole, string> = {
  contestant: "选手",
  judge: "评委",
};

export async function buildAccountWorkbook(
  users: CompetitionUser[],
  role: CompetitionRole,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = SYSTEM_NAME;
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(`${roleNames[role]}账号`);

  sheet.columns = [
    { header: "账号", key: "username", width: 24 },
    { header: "密码", key: "password", width: 24 },
    { header: "名字", key: "displayName", width: 24 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };
  sheet.getRow(1).height = 22;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  users
    .filter((user) => user.role === role)
    .forEach((user) => sheet.addRow({
      username: user.username,
      password: user.password ?? "需重置后显示",
      displayName: user.displayName,
    }));
  sheet.eachRow((row) => {
    row.alignment = { vertical: "middle" };
  });

  const data = await workbook.xlsx.writeBuffer();
  return new Uint8Array(data);
}

export function accountExportFilename(role: CompetitionRole, date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
  return `${SYSTEM_NAME}-${roleNames[role]}账号-${day}.xlsx`;
}
