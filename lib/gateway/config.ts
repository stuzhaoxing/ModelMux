import { quotaEnforced, type OperationModeState } from "./operation-mode";
import type {
  DeploymentMode,
  GatewayConfig,
  GatewayStatus,
  ModelFamily,
  ModelInputModality,
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
  displayName: string;
  description: string;
  family: ModelFamily;
  tier: ModelTier;
  inputModalities: ModelInputModality[];
  contextWindowTokens: number | null;
}

type ModelIdentity = Pick<
  ModelPresentation,
  | "family"
  | "tier"
  | "inputModalities"
  | "contextWindowTokens"
>;

const TEXT_INPUT: ModelInputModality[] = ["text"];
const MULTIMODAL_INPUT: ModelInputModality[] = ["text", "image", "video"];

const PLATFORM_MODEL_NAMES: Record<string, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
  "qwen3.7-flash": "Qwen 3.7 Flash",
  "qwen3.7-plus": "Qwen 3.7 Plus",
  "qwen3.7-max": "Qwen 3.7 Max",
  "qwen3.8-max": "Qwen 3.8 Max",
  "ZHIPU/GLM-5.3": "GLM-5.3",
  "kimi/kimi-k3": "Kimi K3",
  "MiniMax/MiniMax-M3": "MiniMax M3",
  "doubao-seed-2-0-pro-260215": "Doubao Seed 2.0 Pro",
};

function modelPresentation(
  modelId: string,
  family: ModelFamily = "custom",
  tier: ModelTier = "custom",
  inputModalities: ModelInputModality[] = TEXT_INPUT,
  contextWindowTokens: number | null = null,
): ModelPresentation {
  if (family === "custom" || tier === "custom") {
    return {
      displayName: modelId,
      description: "自定义模型路由",
      family: "custom",
      tier: "custom",
      inputModalities,
      contextWindowTokens,
    };
  }

  const descriptions: Record<
    ModelFamily,
    Partial<Record<ModelTier, string>>
  > = {
    deepseek: {
      flash: "DeepSeek 官方快速模型，支持思考与非思考模式",
      pro: "DeepSeek 官方高能力模型，支持思考与非思考模式",
      plus: "不支持的产品型号",
      max: "不支持的产品档位",
    },
    qwen: {
      flash: "低延迟多模态模型，支持文本、图像与视频理解",
      pro: "不支持的产品型号",
      plus: "均衡型多模态模型，支持文本、图像与视频理解",
      max: "旗舰多模态模型，适合复杂视觉与推理任务",
    },
    glm: {
      flagship: "智谱最新旗舰文本模型，由阿里云百炼智谱原厂直供",
    },
    kimi: {
      flagship: "Moonshot 最新旗舰多模态模型，由阿里云百炼原厂直供",
    },
    minimax: {
      flagship: "MiniMax 最新多模态推理模型，由阿里云百炼原厂直供",
    },
    doubao: {
      flagship: "豆包最新旗舰多模态模型，由火山方舟官方提供",
    },
    custom: {
      custom: "自定义模型路由",
    },
  };

  return {
    displayName: PLATFORM_MODEL_NAMES[modelId] ?? modelId,
    description: descriptions[family][tier] ?? "平台模型路由",
    family,
    tier,
    inputModalities,
    contextWindowTokens,
  };
}

function modelIdentity(modelId: string): ModelIdentity {
  const deepseek = /^deepseek-v4-(flash|pro)$/.exec(modelId);
  if (deepseek) {
    return {
      family: "deepseek",
      tier: deepseek[1] as "flash" | "pro",
      inputModalities: TEXT_INPUT,
      contextWindowTokens: 1_000_000,
    };
  }
  const qwen = /^qwen3\.(?:7|8)-(flash|plus|max)$/.exec(modelId);
  if (qwen) {
    return {
      family: "qwen",
      tier: qwen[1] as "flash" | "plus" | "max",
      inputModalities: MULTIMODAL_INPUT,
      contextWindowTokens: 1_000_000,
    };
  }
  const knownModels: Record<string, ModelIdentity> = {
    "ZHIPU/GLM-5.3": {
      family: "glm",
      tier: "flagship",
      inputModalities: TEXT_INPUT,
      contextWindowTokens: 1_048_576,
    },
    "kimi/kimi-k3": {
      family: "kimi",
      tier: "flagship",
      inputModalities: MULTIMODAL_INPUT,
      contextWindowTokens: 1_048_576,
    },
    "MiniMax/MiniMax-M3": {
      family: "minimax",
      tier: "flagship",
      inputModalities: MULTIMODAL_INPUT,
      contextWindowTokens: 196_608,
    },
    "doubao-seed-2-0-pro-260215": {
      family: "doubao",
      tier: "flagship",
      inputModalities: MULTIMODAL_INPUT,
      contextWindowTokens: null,
    },
  };
  return knownModels[modelId] ?? {
    family: "custom",
    tier: "custom",
    inputModalities: TEXT_INPUT,
    contextWindowTokens: null,
  };
}

function modelGroup(
  modelId: string,
  routes: ProviderRoute[],
  identity: ModelIdentity = modelIdentity(modelId),
): ModelRouteGroup {
  return {
    alias: modelId,
    ...modelPresentation(
      modelId,
      identity.family,
      identity.tier,
      identity.inputModalities,
      identity.contextWindowTokens,
    ),
    routes,
  };
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
  const arkBaseUrl = normalizeBaseUrl(
    envValue(env.ARK_BASE_URL, "https://ark.cn-beijing.volces.com/api"),
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
  const dashscopeDirectRoute = (
    provider: string,
    model: string,
  ): ProviderRoute[] => [
    {
      provider,
      baseUrl: dashscopeBaseUrl,
      upstreamModel: model,
      apiKeyEnv: "DASHSCOPE_API_KEYS",
      priority: 100,
      adapter: "dashscope",
    },
  ];
  const arkRoute = (model: string): ProviderRoute[] => [
    {
      provider: "ark",
      baseUrl: arkBaseUrl,
      upstreamModel: model,
      apiKeyEnv: "ARK_API_KEYS",
      priority: 100,
      adapter: "openai",
      chatCompletionsPath: "/v3/chat/completions",
    },
  ];
  const deepseekFlashModel = envValue(
    env.MODEL_DEEPSEEK_FLASH,
    "deepseek-v4-flash",
  );
  const deepseekProModel = envValue(
    env.MODEL_DEEPSEEK_PRO,
    "deepseek-v4-pro",
  );
  const qwenFlashModel = envValue(env.MODEL_QWEN_FLASH, "qwen3.7-flash");
  const qwenPlusModel = envValue(env.MODEL_QWEN_PLUS, "qwen3.7-plus");
  const qwenMaxModel = envValue(env.MODEL_QWEN_MAX, "qwen3.7-max");
  const qwenFlagshipModel = envValue(
    env.MODEL_QWEN_3_8_MAX,
    "qwen3.8-max",
  );
  const glmModel = envValue(env.MODEL_GLM_5_3, "ZHIPU/GLM-5.3");
  const kimiModel = envValue(env.MODEL_KIMI_K3, "kimi/kimi-k3");
  const minimaxModel = envValue(
    env.MODEL_MINIMAX_M3,
    "MiniMax/MiniMax-M3",
  );
  const doubaoModel = envValue(
    env.MODEL_DOUBAO_SEED_2_0_PRO,
    "doubao-seed-2-0-pro-260215",
  );
  const models: ModelRouteGroup[] = [
    modelGroup(
      deepseekFlashModel,
      deepseekRoutes(
        deepseekFlashModel,
        envValue(
          env.SILICONFLOW_MODEL_DEEPSEEK_FLASH,
          "deepseek-ai/DeepSeek-V3.2",
        ),
      ),
      {
        family: "deepseek",
        tier: "flash",
        inputModalities: TEXT_INPUT,
        contextWindowTokens: 1_000_000,
      },
    ),
    modelGroup(
      deepseekProModel,
      deepseekRoutes(
        deepseekProModel,
        envValue(
          env.SILICONFLOW_MODEL_DEEPSEEK_PRO,
          "Pro/deepseek-ai/DeepSeek-V3.2",
        ),
      ),
      {
        family: "deepseek",
        tier: "pro",
        inputModalities: TEXT_INPUT,
        contextWindowTokens: 1_000_000,
      },
    ),
    modelGroup(
      qwenFlashModel,
      qwenRoutes(
        qwenFlashModel,
        envValue(
          env.SILICONFLOW_MODEL_QWEN_FLASH,
          "Qwen/Qwen3.5-35B-A3B",
        ),
      ),
      {
        family: "qwen",
        tier: "flash",
        inputModalities: MULTIMODAL_INPUT,
        contextWindowTokens: 1_000_000,
      },
    ),
    modelGroup(
      qwenPlusModel,
      qwenRoutes(
        qwenPlusModel,
        envValue(
          env.SILICONFLOW_MODEL_QWEN_PLUS,
          "Qwen/Qwen3.5-122B-A10B",
        ),
      ),
      {
        family: "qwen",
        tier: "plus",
        inputModalities: MULTIMODAL_INPUT,
        contextWindowTokens: 1_000_000,
      },
    ),
    modelGroup(
      qwenMaxModel,
      qwenRoutes(
        qwenMaxModel,
        envValue(
          env.SILICONFLOW_MODEL_QWEN_MAX,
          "Qwen/Qwen3.5-397B-A17B",
        ),
      ),
      {
        family: "qwen",
        tier: "max",
        inputModalities: MULTIMODAL_INPUT,
        contextWindowTokens: 1_000_000,
      },
    ),
  ];

  if (commaList(env.DASHSCOPE_API_KEYS).length > 0) {
    models.push(
      modelGroup(
        qwenFlagshipModel,
        dashscopeDirectRoute("aliyun", qwenFlagshipModel),
        {
          family: "qwen",
          tier: "flagship",
          inputModalities: MULTIMODAL_INPUT,
          contextWindowTokens: 1_000_000,
        },
      ),
      modelGroup(
        glmModel,
        dashscopeDirectRoute("aliyun-zhipu", glmModel),
        {
          family: "glm",
          tier: "flagship",
          inputModalities: TEXT_INPUT,
          contextWindowTokens: 1_048_576,
        },
      ),
      modelGroup(
        kimiModel,
        dashscopeDirectRoute("aliyun-kimi", kimiModel),
        {
          family: "kimi",
          tier: "flagship",
          inputModalities: MULTIMODAL_INPUT,
          contextWindowTokens: 1_048_576,
        },
      ),
      modelGroup(
        minimaxModel,
        dashscopeDirectRoute("aliyun-minimax", minimaxModel),
        {
          family: "minimax",
          tier: "flagship",
          inputModalities: MULTIMODAL_INPUT,
          contextWindowTokens: 196_608,
        },
      ),
    );
  }

  if (commaList(env.ARK_API_KEYS).length > 0) {
    models.push(
      modelGroup(doubaoModel, arkRoute(doubaoModel), {
        family: "doubao",
        tier: "flagship",
        inputModalities: MULTIMODAL_INPUT,
        contextWindowTokens: null,
      }),
    );
  }

  return models;
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
    (route.adapter === undefined || isProviderAdapter(route.adapter)) &&
    (route.chatCompletionsPath === undefined ||
      (typeof route.chatCompletionsPath === "string" &&
        route.chatCompletionsPath.startsWith("/")))
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

    const models = Object.entries(parsed).map(([modelId, value]) => {
      if (
        !modelId ||
        modelId !== modelId.trim() ||
        !Array.isArray(value) ||
        value.length === 0 ||
        !value.every(isProviderRoute)
      ) {
        throw new Error(`invalid route group: ${modelId}`);
      }
      const routes = value
        .map((route) => ({
          ...route,
          baseUrl: normalizeBaseUrl(route.baseUrl),
        }))
        .sort((left, right) => right.priority - left.priority);
      if (modelId !== routes[0].upstreamModel) {
        throw new Error(
          `public model id '${modelId}' must match primary upstream model '${routes[0].upstreamModel}'`,
        );
      }
      return modelGroup(modelId, routes);
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
    displayName: model.displayName,
    description: model.description,
    family: model.family,
    tier: model.tier,
    inputModalities: model.inputModalities,
    contextWindowTokens: model.contextWindowTokens,
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
