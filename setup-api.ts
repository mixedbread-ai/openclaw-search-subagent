/**
 * Setup-surface entry point (loaded from `setup-api.*` by convention).
 *
 * OpenClaw's setup registry executes this file — not the main extension — for
 * metadata-only flows: `openclaw models auth login` provider discovery,
 * config migrations in `openclaw doctor` / onboarding, and auto-enable
 * probes. Register only setup-relevant surfaces here.
 */
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, PROVIDER_ID, parsePluginConfig } from "./src/config.js";
import { registerMixedbreadProvider } from "./src/provider.js";
import { applySearchSubagentDefaults } from "./src/setup.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Mixedbread Search Subagent",
  register(api) {
    registerMixedbreadProvider(api, parsePluginConfig(api.pluginConfig));
    api.registerConfigMigration((cfg) => applySearchSubagentDefaults(cfg));
    api.registerAutoEnableProbe((ctx) => {
      if (ctx.env?.MIXEDBREAD_API_KEY) return "MIXEDBREAD_API_KEY is set";
      const cfg = ctx.config as {
        models?: { providers?: Record<string, unknown> };
        agents?: { list?: Array<{ model?: unknown } | undefined> };
      };
      if (cfg?.models?.providers?.[PROVIDER_ID]) return `models.providers.${PROVIDER_ID} is configured`;
      if (cfg?.agents?.list?.some((agent) => typeof agent?.model === "string" && agent.model.startsWith(`${PROVIDER_ID}/`))) {
        return `an agent uses a ${PROVIDER_ID}/ model`;
      }
      return undefined;
    });
  },
});
