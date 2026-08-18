import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerSearchSubagentCli } from "./cli.js";
import { PLUGIN_ID, PROVIDER_ID, parsePluginConfig } from "./config.js";
import { registerMixedbreadProvider } from "./provider.js";
import { applySearchSubagentDefaults } from "./setup.js";
import { registerSearchSubagentTool } from "./tool.js";

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Mixedbread Search Subagent",
  description:
    "Registers the Mixedbread Toast-1 model provider and a search_subagent tool " +
    "that delegates local grep/ripgrep searches to a Toast-1 subagent.",
  register(api) {
    const config = parsePluginConfig(api.pluginConfig);
    registerMixedbreadProvider(api, config);
    registerSearchSubagentTool(api, config);
    registerSearchSubagentCli(api);
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
