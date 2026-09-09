import { competitionModeFromControl } from "@/lib/competition/control";
import { getCompetitionControl } from "@/lib/competition/repository";

export type OperationMode = "test" | "competition";

export interface OperationModeState {
  mode: OperationMode;
  updatedAt: string | null;
  stateFileValid: boolean;
}

export function isOperationMode(value: unknown): value is OperationMode {
  return value === "test" || value === "competition";
}

export async function operationModeState(): Promise<OperationModeState> {
  if (!process.env.MODELMUX_DATABASE_URL) {
    return { mode: "test", updatedAt: null, stateFileValid: true };
  }
  const control = await getCompetitionControl();
  return {
    mode: competitionModeFromControl(control),
    updatedAt: control.startedAt,
    stateFileValid: true,
  };
}
