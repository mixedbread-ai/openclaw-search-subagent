import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { PLUGIN_ID, parsePluginConfig } from "./config.js";
import { registerMixedbreadProvider } from "./provider.js";
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
  },
});
