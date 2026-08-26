import type { OperationMode } from "./operation-mode";

export type DeploymentMode = "local" | "public";

export type ModelFamily =
  | "deepseek"
  | "qwen"
  | "glm"
  | "kimi"
  | "minimax"
  | "doubao"
  | "custom";
export type ModelTier =
  | "flash"
  | "pro"
  | "plus"
  | "max"
  | "flagship"
  | "custom";
export type ModelInputModality = "text" | "image" | "video";
export type ProviderAdapter =
  | "openai"
  | "deepseek"
  | "dashscope"
  | "siliconflow";

export interface ProviderRoute {
  provider: string;
  baseUrl: string;
  upstreamModel: string;
  apiKeyEnv: string;
  priority: number;
  adapter?: ProviderAdapter;
  chatCompletionsPath?: string;
}

export interface ModelRouteGroup {
  alias: string;
  displayName: string;
  description: string;
  family: ModelFamily;
  tier: ModelTier;
  inputModalities: ModelInputModality[];
  contextWindowTokens: number | null;
  routes: ProviderRoute[];
}

export interface PublicProviderRoute {
  provider: string;
  upstreamModel: string;
  priority: number;
  configured: boolean;
}

export interface PublicModelRouteGroup {
  alias: string;
  displayName: string;
  description: string;
  family: ModelFamily;
  tier: ModelTier;
  inputModalities: ModelInputModality[];
  contextWindowTokens: number | null;
  routes: PublicProviderRoute[];
}

export interface GatewayConfig {
  deploymentMode: DeploymentMode;
  publicBaseUrl: string | null;
  internalBaseUrl: string | null;
  externalBaseUrl: string | null;
  allowAnonymous: boolean;
  clientKeys: string[];
  rateLimitRpm: number;
  requestTimeoutMs: number;
  maxBodyBytes: number;
  corsOrigins: string[];
  models: ModelRouteGroup[];
}

export interface GatewayIngressEndpoint {
  configured: boolean;
  origin: string | null;
  apiBase: string | null;
  host: string | null;
  port: number | null;
}

export interface GatewayStatus {
  state: "running" | "needs_config" | "suspended";
  deploymentMode: DeploymentMode;
  apiBase: string;
  internalEndpoint: GatewayIngressEndpoint;
  externalEndpoint: GatewayIngressEndpoint;
  startedAt: number;
  providerConfigured: boolean;
  clientAuthConfigured: boolean;
  allowAnonymous: boolean;
  rateLimitRpm: number;
  maxBodyBytes: number;
  serviceEnabled: boolean;
  serviceStateUpdatedAt: string | null;
  serviceStateFileValid: boolean;
  operationMode: OperationMode;
  operationModeUpdatedAt: string | null;
  operationModeStateFileValid: boolean;
  quotaEnforced: boolean;
  modelAliases: PublicModelRouteGroup[];
}

export interface RequestLog {
  id: string;
  timestamp: number;
  model: string;
  provider: string | null;
  upstreamModel: string | null;
  status: number;
  durationMs: number;
  attempts: number;
  client: string;
  errorCode: string | null;
}

export interface GatewayMetrics {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  activeClients: number;
  successRate: number | null;
}
