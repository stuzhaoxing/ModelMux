import { quotaEnforced, type OperationModeState } from "./operation-mode";
import type {
  DeploymentMode,
  GatewayConfig,
  GatewayStatus,
  ModelFamily,
  ModelRouteGroup,
  ModelTier,
  ProviderAdapter,
  ProviderRoute,
  PublicModelRouteGroup,
} from "./types";

const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_RATE_LIMIT_RPM = 60;

function commaList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function envValue(value: string | undefined, fallback: string): string {
  return value?.trim() || fallback;
}

function optionalBaseUrl(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalizeBaseUrl(normalized) : null;
}

function ingressEndpoint(value: string | null): GatewayStatus["internalEndpoint"] {
  if (!value) {
    return { configured: false, origin: null, apiBase: null, host: null, port: null };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsupported protocol");
    const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;
    return {
      configured: true,
      origin: url.origin,
      apiBase: `${url.origin}/v1`,
      host: url.hostname,
      port,
    };
  } catch {
    return { configured: false, origin: null, apiBase: null, host: null, port: null };
  }
}

function deploymentMode(value: string | undefined): DeploymentMode {
  return value === "public" ? "public" : "local";
}

interface ModelPresentation {
  compatibilityAliases: string[];
  displayName: string;
  description: string;
  family: ModelFamily;
  tier: ModelTier;
}

function modelPresentation(alias: string): ModelPresentation {
  const match = /^(deepseek|qwen)-(flash|pro|max)$/.exec(alias);
  if (!match || (match[1] === "deepseek" && match[2] === "max")) {
    return {
      compatibilityAliases: [],
      displayName: alias,
      description: "自定义模型路由",
      family: "custom",
      tier: "custom",
    };
  }

  const family = match[1] as Exclude<ModelFamily, "custom">;
  const tier = match[2] as Exclude<ModelTier, "custom">;
  const familyName = family === "deepseek" ? "DeepSeek" : "Qwen";
  const tierName = tier === "flash" ? "Flash" : tier === "pro" ? "Pro" : "Max";
  const descriptions = {
    deepseek: {
      flash: "DeepSeek 官方快速模型，支持思考与非思考模式",
      pro: "DeepSeek 官方高能力模型，支持思考与非思考模式",
      max: "不支持的产品档位",
    },
    qwen: {
      flash: "低延迟多模态模型，支持文本、图像与视频理解",
      pro: "均衡型多模态模型，支持文本、图像与视频理解",
      max: "旗舰多模态模型，适合复杂视觉与推理任务",
    },
  } as const;

  return {
    compatibilityAliases: tier === "pro" ? [family] : [],
    displayName: `${familyName} ${tierName}`,
    description: descriptions[family][tier],
    family,
    tier,
  };
}

function modelGroup(
  alias: string,
  routes: ProviderRoute[],
): ModelRouteGroup {
  return { alias, ...modelPresentation(alias), routes };
}

function defaultModels(env: NodeJS.ProcessEnv): ModelRouteGroup[] {
  const deepseekBaseUrl = normalizeBaseUrl(
    envValue(env.DEEPSEEK_BASE_URL, "https://api.deepseek.com"),
  );
  const dashscopeBaseUrl = normalizeBaseUrl(
    envValue(
      env.DASHSCOPE_BASE_URL,
      "https://dashscope.aliyuncs.com/compatible-mode",
    ),
  );
  const siliconflowBaseUrl = normalizeBaseUrl(
    envValue(env.SILICONFLOW_BASE_URL, "https://api.siliconflow.cn"),
  );

  const deepseekRoutes = (
    officialModel: string,
    siliconflowModel: string,
  ): ProviderRoute[] => [
    {
      provider: "deepseek",
      baseUrl: deepseekBaseUrl,
      upstreamModel: officialModel,
      apiKeyEnv: "DEEPSEEK_API_KEYS",
      priority: 100,
      adapter: "deepseek",
    },
    {
      provider: "siliconflow",
      baseUrl: siliconflowBaseUrl,
      upstreamModel: siliconflowModel,
      apiKeyEnv: "SILICONFLOW_API_KEYS",
      priority: 70,
      adapter: "siliconflow",
    },
  ];
  const qwenRoutes = (
    officialModel: string,
    siliconflowModel: string,
  ): ProviderRoute[] => [
    {
      provider: "aliyun",
      baseUrl: dashscopeBaseUrl,
      upstreamModel: officialModel,
      apiKeyEnv: "DASHSCOPE_API_KEYS",
      priority: 100,
      adapter: "dashscope",
    },
    {
      provider: "siliconflow",
      baseUrl: siliconflowBaseUrl,
      upstreamModel: siliconflowModel,
      apiKeyEnv: "SILICONFLOW_API_KEYS",
      priority: 70,
      adapter: "siliconflow",
    },
  ];

  return [
    modelGroup(
      "deepseek-flash",
      deepseekRoutes(
        envValue(env.MODEL_DEEPSEEK_FLASH, "deepseek-v4-flash"),
        envValue(
          env.SILICONFLOW_MODEL_DEEPSEEK_FLASH,
          "deepseek-ai/DeepSeek-V3.2",
        ),
      ),
    ),
    modelGroup(
      "deepseek-pro",
      deepseekRoutes(
        envValue(
          env.MODEL_DEEPSEEK_PRO ?? env.MODEL_DEEPSEEK,
          "deepseek-v4-pro",
        ),
        envValue(
          env.SILICONFLOW_MODEL_DEEPSEEK_PRO,
          "Pro/deepseek-ai/DeepSeek-V3.2",
        ),
      ),
    ),
    modelGroup(
      "qwen-flash",
      qwenRoutes(
        envValue(env.MODEL_QWEN_FLASH, "qwen3.7-flash"),
        envValue(
          env.SILICONFLOW_MODEL_QWEN_FLASH,
          "Qwen/Qwen3.5-35B-A3B",
        ),
      ),
    ),
    modelGroup(
      "qwen-pro",
      qwenRoutes(
        envValue(env.MODEL_QWEN_PRO ?? env.MODEL_QWEN, "qwen3.7-plus"),
        envValue(
          env.SILICONFLOW_MODEL_QWEN_PRO,
          "Qwen/Qwen3.5-122B-A10B",
        ),
      ),
    ),
    modelGroup(
      "qwen-max",
      qwenRoutes(
        envValue(env.MODEL_QWEN_MAX, "qwen3.7-max"),
        envValue(
          env.SILICONFLOW_MODEL_QWEN_MAX,
          "Qwen/Qwen3.5-397B-A17B",
        ),
      ),
    ),
  ];
}

function isProviderAdapter(value: unknown): value is ProviderAdapter {
  return (
    value === "openai" ||
    value === "deepseek" ||
    value === "dashscope" ||
    value === "siliconflow"
  );
}

function isProviderRoute(value: unknown): value is ProviderRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as Record<string, unknown>;
  return (
    typeof route.provider === "string" &&
    typeof route.baseUrl === "string" &&
    typeof route.upstreamModel === "string" &&
    typeof route.apiKeyEnv === "string" &&
    typeof route.priority === "number" &&
    Number.isFinite(route.priority) &&
    (route.adapter === undefined || isProviderAdapter(route.adapter))
  );
}

function configuredModels(env: NodeJS.ProcessEnv): ModelRouteGroup[] {
  const raw = env.MODELMUX_ROUTES_JSON;
  if (!raw) return defaultModels(env);

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("route map must be an object");
    }

    const models = Object.entries(parsed).map(([alias, value]) => {
      if (!alias.trim() || !Array.isArray(value) || !value.every(isProviderRoute)) {
        throw new Error(`invalid route group: ${alias}`);
      }
      const normalizedAlias = alias.trim().toLowerCase();
      if (normalizedAlias === "deepseek-max") {
        throw new Error(
          "deepseek-max is not an official DeepSeek model alias",
        );
      }
      return modelGroup(
        normalizedAlias,
        value
          .map((route) => ({
            ...route,
            baseUrl: normalizeBaseUrl(route.baseUrl),
          }))
          .sort((left, right) => right.priority - left.priority),
      );
    });

    if (models.length === 0) throw new Error("route map is empty");
    return models;
  } catch (error) {
    throw new Error(
      `MODELMUX_ROUTES_JSON is invalid: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function loadGatewayConfig(
  env: NodeJS.ProcessEnv = process.env,
): GatewayConfig {
  return {
    deploymentMode: deploymentMode(env.MODELMUX_DEPLOYMENT_MODE),
    publicBaseUrl: optionalBaseUrl(env.MODELMUX_PUBLIC_BASE_URL),
    internalBaseUrl: optionalBaseUrl(env.MODELMUX_INTERNAL_BASE_URL),
    externalBaseUrl: optionalBaseUrl(env.MODELMUX_EXTERNAL_BASE_URL),
    allowAnonymous: env.MODELMUX_ALLOW_ANONYMOUS === "true",
    clientKeys: commaList(env.MODELMUX_CLIENT_KEYS),
    rateLimitRpm: positiveInteger(
      env.MODELMUX_RATE_LIMIT_RPM,
      DEFAULT_RATE_LIMIT_RPM,
    ),
    requestTimeoutMs: positiveInteger(
      env.MODELMUX_REQUEST_TIMEOUT_MS,
      DEFAULT_REQUEST_TIMEOUT_MS,
    ),
    maxBodyBytes: positiveInteger(
      env.MODELMUX_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
    corsOrigins: commaList(env.MODELMUX_CORS_ORIGINS),
    models: configuredModels(env),
  };
}

export function publicModels(
  config: GatewayConfig,
  env: NodeJS.ProcessEnv = process.env,
): PublicModelRouteGroup[] {
  return config.models.map((model) => ({
    alias: model.alias,
    compatibilityAliases: model.compatibilityAliases,
    displayName: model.displayName,
    description: model.description,
    family: model.family,
    tier: model.tier,
    routes: model.routes.map((route) => ({
      provider: route.provider,
      upstreamModel: route.upstreamModel,
      priority: route.priority,
      configured: commaList(env[route.apiKeyEnv]).length > 0,
    })),
  }));
}

export function gatewayStatus(
  requestOrigin: string,
  startedAt: number,
  env: NodeJS.ProcessEnv = process.env,
  serviceState: {
    enabled: boolean;
    updatedAt: string | null;
    stateFileValid: boolean;
  } = { enabled: true, updatedAt: null, stateFileValid: true },
  modeState: OperationModeState = {
    mode: "test",
    updatedAt: null,
    stateFileValid: true,
  },
): GatewayStatus {
  const config = loadGatewayConfig(env);
  const modelAliases = publicModels(config, env);
  const providerConfigured = modelAliases.every((model) =>
    model.routes.some((route) => route.configured),
  );
  const clientAuthConfigured =
    config.allowAnonymous ||
    config.clientKeys.length > 0 ||
    Boolean(env.MODELMUX_DATABASE_URL?.trim());
  const apiOrigin = config.publicBaseUrl ?? requestOrigin;
  const internalBaseUrl = config.internalBaseUrl ?? (config.deploymentMode === "local" ? apiOrigin : requestOrigin);
  const externalBaseUrl = config.externalBaseUrl ?? (config.deploymentMode === "public" ? apiOrigin : null);

  return {
    state:
      !serviceState.enabled
        ? "suspended"
        : providerConfigured && clientAuthConfigured
          ? "running"
          : "needs_config",
    deploymentMode: config.deploymentMode,
    apiBase: `${apiOrigin}/v1`,
    internalEndpoint: ingressEndpoint(internalBaseUrl),
    externalEndpoint: ingressEndpoint(externalBaseUrl),
    startedAt,
    providerConfigured,
    clientAuthConfigured,
    allowAnonymous: config.allowAnonymous,
    rateLimitRpm: config.rateLimitRpm,
    maxBodyBytes: config.maxBodyBytes,
    serviceEnabled: serviceState.enabled,
    serviceStateUpdatedAt: serviceState.updatedAt,
    serviceStateFileValid: serviceState.stateFileValid,
    operationMode: modeState.mode,
    operationModeUpdatedAt: modeState.updatedAt,
    operationModeStateFileValid: modeState.stateFileValid,
    quotaEnforced: quotaEnforced(modeState.mode),
    modelAliases,
  };
}

export function providerKeys(
  route: ProviderRoute,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  return commaList(env[route.apiKeyEnv]);
}
