import { describe, expect, it } from "vitest";

import { gatewayStatus, loadGatewayConfig, publicModels } from "./config";

function env(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    ...overrides,
    NODE_ENV: "test",
  } as NodeJS.ProcessEnv;
}

describe("gateway config", () => {
  it("uses local, authenticated defaults", () => {
    const config = loadGatewayConfig(env());

    expect(config.deploymentMode).toBe("local");
    expect(config.allowAnonymous).toBe(false);
    expect(config.clientKeys).toEqual([]);
    expect(config.internalBaseUrl).toBeNull();
    expect(config.externalBaseUrl).toBeNull();
    expect(config.models.map((model) => model.alias)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-flash",
      "qwen3.7-plus",
      "qwen3.7-max",
    ]);
    expect(config.models[0].routes[0].priority).toBe(100);
    expect(config.models[3].displayName).toBe("Qwen 3.7 Plus");
    expect(config.models.map((model) => model.contextWindowTokens)).toEqual([
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000,
      1_000_000,
    ]);
    expect(config.models.every(
      (model) => model.alias === model.routes[0].upstreamModel,
    )).toBe(true);
  });

  it("uses an overridden primary platform model ID as the public ID", () => {
    const config = loadGatewayConfig(env({
      MODEL_QWEN_PLUS: "qwen-plus-latest",
    }));
    const model = config.models.find(
      (candidate) => candidate.alias === "qwen-plus-latest",
    );

    expect(model).toMatchObject({
      displayName: "qwen-plus-latest",
      family: "qwen",
      tier: "plus",
    });
    expect(model?.routes[0].upstreamModel).toBe("qwen-plus-latest");
  });

  it("adds the verified DashScope domestic flagship catalog when configured", () => {
    const config = loadGatewayConfig(env({
      DASHSCOPE_API_KEYS: "dashscope-key",
    }));

    expect(config.models.map((model) => model.alias)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-flash",
      "qwen3.7-plus",
      "qwen3.7-max",
      "qwen3.8-max",
      "ZHIPU/GLM-5.3",
      "kimi/kimi-k3",
      "MiniMax/MiniMax-M3",
    ]);
    expect(
      config.models.find((model) => model.alias === "kimi/kimi-k3"),
    ).toMatchObject({
      displayName: "Kimi K3",
      family: "kimi",
      tier: "flagship",
      inputModalities: ["text", "image", "video"],
      contextWindowTokens: 1_048_576,
      routes: [{ provider: "aliyun-kimi", upstreamModel: "kimi/kimi-k3" }],
    });
    expect(
      config.models.find((model) => model.alias === "MiniMax/MiniMax-M3")
        ?.contextWindowTokens,
    ).toBe(196_608);
  });

  it("adds the exact Ark Doubao model only when its key is configured", () => {
    const withoutArk = loadGatewayConfig(env());
    const withArk = loadGatewayConfig(env({ ARK_API_KEYS: "ark-key" }));

    expect(withoutArk.models.some((model) => model.family === "doubao")).toBe(
      false,
    );
    expect(
      withArk.models.find((model) => model.family === "doubao"),
    ).toMatchObject({
      alias: "doubao-seed-2-0-pro-260215",
      displayName: "Doubao Seed 2.0 Pro",
      routes: [{
        provider: "ark",
        upstreamModel: "doubao-seed-2-0-pro-260215",
        chatCompletionsPath: "/v3/chat/completions",
      }],
    });
  });

  it("does not expose provider base URLs or key environment names", () => {
    const customEnv = env({ DEEPSEEK_API_KEYS: "secret-provider-key" });
    const models = publicModels(loadGatewayConfig(customEnv), customEnv);

    expect(models[0].routes[0]).toEqual({
      provider: "deepseek",
      upstreamModel: "deepseek-v4-flash",
      priority: 100,
      configured: true,
    });
    expect(JSON.stringify(models)).not.toContain("secret-provider-key");
    expect(JSON.stringify(models)).not.toContain("apiKeyEnv");
    expect(JSON.stringify(models)).not.toContain("baseUrl");
  });

  it("reports needs_config until provider and client access are configured", () => {
    const missing = gatewayStatus("http://localhost:4000", 1, env());
    const readyEnv = env({
      MODELMUX_DEPLOYMENT_MODE: "public",
      MODELMUX_PUBLIC_BASE_URL: "https://debug.example.com/",
      MODELMUX_CLIENT_KEYS: "client-key",
      SILICONFLOW_API_KEYS: "provider-key",
    });
    const ready = gatewayStatus("http://localhost:4000", 1, readyEnv);

    expect(missing.state).toBe("needs_config");
    expect(ready.state).toBe("running");
    expect(ready.deploymentMode).toBe("public");
    expect(ready.apiBase).toBe("https://debug.example.com/v1");
    expect(ready.internalEndpoint).toMatchObject({
      configured: true,
      origin: "http://localhost:4000",
      port: 4000,
    });
    expect(ready.externalEndpoint).toEqual({
      configured: true,
      origin: "https://debug.example.com",
      apiBase: "https://debug.example.com/v1",
      host: "debug.example.com",
      port: 443,
    });
  });

  it("reports suspended independently of provider configuration", () => {
    const status = gatewayStatus("http://localhost:4000", 1, env(), {
      enabled: false,
      updatedAt: "2026-08-13T02:30:00.000Z",
      stateFileValid: true,
    });

    expect(status.state).toBe("suspended");
    expect(status.serviceEnabled).toBe(false);
    expect(status.serviceStateUpdatedAt).toBe("2026-08-13T02:30:00.000Z");
  });

  it("reports explicit internal and external ingress ports", () => {
    const status = gatewayStatus("http://localhost:1421", 1, env({
      MODELMUX_INTERNAL_BASE_URL: "http://10.20.0.1:4000/",
      MODELMUX_EXTERNAL_BASE_URL: "https://debug.example.com:8443/",
    }));

    expect(status.internalEndpoint).toEqual({
      configured: true,
      origin: "http://10.20.0.1:4000",
      apiBase: "http://10.20.0.1:4000/v1",
      host: "10.20.0.1",
      port: 4000,
    });
    expect(status.externalEndpoint).toEqual({
      configured: true,
      origin: "https://debug.example.com:8443",
      apiBase: "https://debug.example.com:8443/v1",
      host: "debug.example.com",
      port: 8443,
    });
  });

  it("requires every advertised model to have a configured route", () => {
    const routes = {
      "deepseek-model": [
        {
          provider: "primary",
          baseUrl: "https://primary.example.com",
          upstreamModel: "deepseek-model",
          apiKeyEnv: "PRIMARY_KEYS",
          priority: 100,
        },
      ],
      "qwen-model": [
        {
          provider: "backup",
          baseUrl: "https://backup.example.com",
          upstreamModel: "qwen-model",
          apiKeyEnv: "MISSING_KEYS",
          priority: 100,
        },
      ],
    };
    const partialEnv = env({
      MODELMUX_CLIENT_KEYS: "client-key",
      MODELMUX_ROUTES_JSON: JSON.stringify(routes),
      PRIMARY_KEYS: "provider-key",
    });

    expect(gatewayStatus("http://localhost", 1, partialEnv).state).toBe(
      "needs_config",
    );
  });

  it("uses the three providers across the five official product models", () => {
    const config = loadGatewayConfig(env());
    const providers = new Set(
      config.models.flatMap((model) =>
        model.routes.map((route) => route.provider),
      ),
    );

    expect(providers).toEqual(
      new Set(["deepseek", "aliyun", "siliconflow"]),
    );
    expect(
      config.models.find((model) => model.alias === "qwen3.7-flash")?.routes[0],
    ).toMatchObject({
      provider: "aliyun",
      upstreamModel: "qwen3.7-flash",
      adapter: "dashscope",
    });
  });

  it("sorts custom routes by priority", () => {
    const routes = {
      "primary-model": [
        {
          provider: "backup",
          baseUrl: "https://backup.example.com/",
          upstreamModel: "backup-model",
          apiKeyEnv: "BACKUP_KEYS",
          priority: 20,
        },
        {
          provider: "primary",
          baseUrl: "https://primary.example.com/",
          upstreamModel: "primary-model",
          apiKeyEnv: "PRIMARY_KEYS",
          priority: 100,
        },
      ],
    };
    const config = loadGatewayConfig(
      env({ MODELMUX_ROUTES_JSON: JSON.stringify(routes) }),
    );

    expect(config.models[0].routes.map((route) => route.provider)).toEqual([
      "primary",
      "backup",
    ]);
    expect(config.models[0].routes[0].baseUrl).toBe(
      "https://primary.example.com",
    );
  });

  it("rejects a custom public name that differs from its primary platform model", () => {
    expect(() =>
      loadGatewayConfig(
        env({
          MODELMUX_ROUTES_JSON: JSON.stringify({
            "short-name": [
              {
                provider: "deepseek",
                baseUrl: "https://api.deepseek.com",
                upstreamModel: "deepseek-v4-pro",
                apiKeyEnv: "DEEPSEEK_API_KEYS",
                priority: 100,
                adapter: "deepseek",
              },
            ],
          }),
        }),
      ),
    ).toThrow(
      "public model id 'short-name' must match primary upstream model 'deepseek-v4-pro'",
    );
  });
});
