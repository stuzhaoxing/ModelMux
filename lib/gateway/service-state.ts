export interface GatewayServiceState {
  enabled: boolean;
  updatedAt: string | null;
  stateFileValid: boolean;
}

export async function gatewayServiceState(): Promise<GatewayServiceState> {
  // Legacy stop files are ignored: model APIs are always enabled.
  return { enabled: true, updatedAt: null, stateFileValid: true };
}
