import { readStateFile, writeStateFile } from "./state-file";

export interface GatewayServiceState {
  enabled: boolean;
  updatedAt: string | null;
  stateFileValid: boolean;
}

const stateFileName = "gateway-service-state.json";

const defaultState: GatewayServiceState = {
  enabled: true,
  updatedAt: null,
  stateFileValid: true,
};

export async function gatewayServiceState(): Promise<GatewayServiceState> {
  const read = await readStateFile(stateFileName);
  if (read.status === "missing") return defaultState;
  if (read.status === "invalid") {
    return { enabled: false, updatedAt: null, stateFileValid: false };
  }
  const { enabled, updatedAt } = read.value;
  if (
    typeof enabled !== "boolean" ||
    typeof updatedAt !== "string" ||
    !Number.isFinite(Date.parse(updatedAt))
  ) {
    return { enabled: false, updatedAt: null, stateFileValid: false };
  }
  return { enabled, updatedAt, stateFileValid: true };
}

export async function setGatewayServiceEnabled(
  enabled: boolean,
  now = new Date(),
): Promise<GatewayServiceState> {
  const updatedAt = now.toISOString();
  await writeStateFile(stateFileName, { enabled, updatedAt });
  return { enabled, updatedAt, stateFileValid: true };
}
