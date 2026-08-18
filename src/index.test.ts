import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import entry from "./index.js";
import { DEFAULT_BASE_URL } from "./config.js";
import { buildProvider } from "./provider.js";

type ProviderRegistration = { id: string; label: string; envVars?: string[]; auth: Array<{ kind: string }> };

type AutoEnableProbe = (ctx: { config: unknown; env: Record<string, string | undefined> }) => string | string[] | null | undefined;

function registerWithMockApi(pluginConfig?: Record<string, unknown>) {
  const providers: ProviderRegistration[] = [];
  const tools: unknown[] = [];
  const migrations: unknown[] = [];
  const probes: AutoEnableProbe[] = [];
  const api = {
    pluginConfig,
    registerProvider(provider: ProviderRegistration) {
      providers.push(provider);
    },
    registerTool(tool: unknown) {
      tools.push(tool);
    },
    registerConfigMigration(migrate: unknown) {
      migrations.push(migrate);
    },
    registerAutoEnableProbe(probe: AutoEnableProbe) {
      probes.push(probe);
    },
    registerCli() {},
  } as unknown as OpenClawPluginApi;
  entry.register?.(api);
  return { providers, tools, migrations, probes };
}

describe("search-subagent plugin entry", () => {
  it("registers the mixedbread provider and the search tool", () => {
    const { providers, tools, migrations } = registerWithMockApi();

    expect(providers.map((provider) => provider.id)).toEqual(["mixedbread"]);
    expect(providers[0]?.label).toBe("Mixedbread");
    expect(providers[0]?.envVars).toEqual(["MIXEDBREAD_API_KEY"]);
    expect(providers[0]?.auth[0]?.kind).toBe("api_key");
    expect(tools).toHaveLength(1);
    expect(typeof tools[0]).toBe("function");
    expect(migrations).toHaveLength(1);
  });

  it("auto-enables when a mixedbread signal is present", () => {
    const { probes } = registerWithMockApi();
    const probe = probes[0]!;

    expect(probe({ config: {}, env: { MIXEDBREAD_API_KEY: "mxb_x" } })).toMatch(/MIXEDBREAD_API_KEY/);
    expect(probe({ config: { models: { providers: { mixedbread: {} } } }, env: {} })).toMatch(/models\.providers/);
    expect(probe({ config: { agents: { list: [{ model: "mixedbread/toast-1" }] } }, env: {} })).toMatch(/agent uses/);
    expect(probe({ config: {}, env: {} })).toBeUndefined();
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
        maxTokens: 4096,
      }),
    ]);
  });

  it("honors baseUrl and apiKey overrides from plugin config", () => {
    const provider = buildProvider({ baseUrl: "https://example.test/v1", apiKey: "test-key" });

    expect(provider.baseUrl).toBe("https://example.test/v1");
    expect(provider.apiKey).toBe("test-key");
  });
});
