import { readStateFile, writeStateFile } from "./state-file";

export type OperationMode = "test" | "competition";

export interface OperationModeState {
  mode: OperationMode;
  updatedAt: string | null;
  stateFileValid: boolean;
}

const stateFileName = "gateway-operation-mode.json";

// 测试模式是最保守的展示默认值。状态文件丢失或损坏时，
// 大屏回到演练状态，模型 API 转发行为不受模式影响。
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
