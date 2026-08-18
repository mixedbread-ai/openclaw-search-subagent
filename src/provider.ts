import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { buildSingleProviderApiKeyCatalog } from "openclaw/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL_ID,
  DEFAULT_MODEL_REF,
  PROVIDER_ID,
  type SearchSubagentConfig,
} from "./config.js";

export function buildProvider(config?: Pick<SearchSubagentConfig, "baseUrl" | "apiKey">): ModelProviderConfig {
  return {
    api: "openai-completions",
    baseUrl: config?.baseUrl ?? DEFAULT_BASE_URL,
    ...(config?.apiKey ? { apiKey: config.apiKey } : {}),
    models: [
      {
        id: DEFAULT_MODEL_ID,
        name: "Toast-1",
        // Toast-1 emits reasoning_content, so flag it as a reasoning model.
        reasoning: true,
        input: ["text"],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 131000,
        maxTokens: 4096,
      },
    ],
  };
}

export function registerMixedbreadProvider(api: OpenClawPluginApi, config: SearchSubagentConfig): void {
  api.registerProvider({
    id: PROVIDER_ID,
    label: "Mixedbread",
    docsPath: "/providers/mixedbread",
    envVars: ["MIXEDBREAD_API_KEY"],
    auth: [
      createProviderApiKeyAuthMethod({
        providerId: PROVIDER_ID,
        methodId: "api-key",
        label: "Mixedbread API key",
        hint: "API key from your Mixedbread dashboard (mixedbread.com)",
        optionKey: "mixedbreadApiKey",
        flagName: "--mixedbread-api-key",
        envVar: "MIXEDBREAD_API_KEY",
        promptMessage: "Enter your Mixedbread API key",
        defaultModel: DEFAULT_MODEL_REF,
        expectedProviders: [PROVIDER_ID],
        noteTitle: "Mixedbread",
        noteMessage: "Uses https://api.mixedbread.com/v1 (OpenAI-compatible).",
      }),
    ],
    catalog: {
      order: "simple",
      run: (ctx) =>
        buildSingleProviderApiKeyCatalog({
          ctx,
          providerId: PROVIDER_ID,
          buildProvider: () => buildProvider(config),
          allowExplicitBaseUrl: true,
        }),
    },
  });
}
