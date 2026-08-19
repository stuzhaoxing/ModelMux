import { readStateFile, writeStateFile } from "./state-file";

export type OperationMode = "test" | "competition";

export interface OperationModeState {
  mode: OperationMode;
  updatedAt: string | null;
  stateFileValid: boolean;
}

const stateFileName = "gateway-operation-mode.json";

// 测试模式是最保守的默认值：额度照常扣减。状态文件丢失或损坏时，
// 公网测试实例不会因此变成"不限量"，只会退回到有限额度。
const defaultState: OperationModeState = {
  mode: "test",
  updatedAt: null,
  stateFileValid: true,
};

export function isOperationMode(value: unknown): value is OperationMode {
  return value === "test" || value === "competition";
}

export async function operationModeState(): Promise<OperationModeState> {
  const read = await readStateFile(stateFileName);
  if (read.status === "missing") return defaultState;
  if (read.status === "invalid") {
    return { mode: "test", updatedAt: null, stateFileValid: false };
  }
  const { mode, updatedAt } = read.value;
  if (
    !isOperationMode(mode) ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    return { mode: "test", updatedAt: null, stateFileValid: false };
  }
  return { mode, updatedAt, stateFileValid: true };
}

export async function setOperationMode(
  mode: OperationMode,
  now = new Date(),
): Promise<OperationModeState> {
  const updatedAt = now.toISOString();
  await writeStateFile(stateFileName, { mode, updatedAt });
  return { mode, updatedAt, stateFileValid: true };
}

// 比赛模式只解除总额度上限，每分钟频率限制在两种模式下都保留。
export function quotaEnforced(mode: OperationMode): boolean {
  return mode === "test";
}
