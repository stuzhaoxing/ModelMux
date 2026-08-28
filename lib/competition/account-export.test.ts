import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import { accountExportFilename, buildAccountWorkbook } from "./account-export";
import type { CompetitionUser } from "./types";

const users: CompetitionUser[] = [
  {
    id: 1,
    role: "contestant",
    username: "player01",
    displayName: "选手一",
    password: "player-pass",
    apiKey: "sk-competition-player",
    active: true,
    createdAt: "2026-08-13 10:00:00.000",
    lastLoginAt: null,
  },
  {
    id: 2,
    role: "judge",
    username: "judge01",
    displayName: "评委一",
    password: "judge-pass",
    apiKey: null,
    active: true,
    createdAt: "2026-08-13 10:00:00.000",
    lastLoginAt: null,
  },
];

describe("competition account Excel export", () => {
  it("exports only the selected role with account, password and name columns", async () => {
    const data = await buildAccountWorkbook(users, "contestant");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data.buffer);
    const sheet = workbook.getWorksheet("选手账号");

    expect(sheet?.getSheetValues()).toEqual([
      undefined,
      [undefined, "账号", "密码", "名字"],
      [undefined, "player01", "player-pass", "选手一"],
    ]);
  });

  it("uses the Shanghai calendar date in the filename", () => {
    expect(accountExportFilename("judge", new Date("2026-08-13T16:30:00Z")))
      .toBe("江苏省监测技能竞赛在线答题系统-评委账号-2026-08-14.xlsx");
  });
});
