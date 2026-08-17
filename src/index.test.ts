import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import entry from "./index.js";
import { DEFAULT_BASE_URL } from "./config.js";
import { buildProvider } from "./provider.js";

type ProviderRegistration = { id: string; label: string; envVars?: string[]; auth: Array<{ kind: string }> };

function registerWithMockApi(pluginConfig?: Record<string, unknown>) {
  const providers: ProviderRegistration[] = [];
  const tools: unknown[] = [];
  const api = {
    pluginConfig,
    registerProvider(provider: ProviderRegistration) {
      providers.push(provider);
    },
    registerTool(tool: unknown) {
      tools.push(tool);
    },
  } as unknown as OpenClawPluginApi;
  entry.register?.(api);
  return { providers, tools };
}

describe("search-subagent plugin entry", () => {
  it("registers the mixedbread provider and the search tool", () => {
    const { providers, tools } = registerWithMockApi();

    expect(providers.map((provider) => provider.id)).toEqual(["mixedbread"]);
    expect(providers[0]?.label).toBe("Mixedbread");
    expect(providers[0]?.envVars).toEqual(["MIXEDBREAD_API_KEY"]);
    expect(providers[0]?.auth[0]?.kind).toBe("api_key");
    expect(tools).toHaveLength(1);
    expect(typeof tools[0]).toBe("function");
  });
});

describe("buildProvider", () => {
  it("defaults to the public Mixedbread endpoint and Toast-1 model", () => {
    const provider = buildProvider();

    expect(provider.api).toBe("openai-completions");
    expect(provider.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(provider).not.toHaveProperty("apiKey");
    expect(provider.models).toEqual([
      expect.objectContaining({
        id: "toast-1",
        name: "Toast-1",
        contextWindow: 131000,
        maxTokens: 8000,
      }),
    ]);
  });

  it("honors baseUrl and apiKey overrides from plugin config", () => {
    const provider = buildProvider({ baseUrl: "https://example.test/v1", apiKey: "test-key" });

    expect(provider.baseUrl).toBe("https://example.test/v1");
    expect(provider.apiKey).toBe("test-key");
  });
});
