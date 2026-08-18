import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_MODEL_REF, DEFAULT_SEARCH_AGENT_ID, PLUGIN_ID, PROVIDER_ID, TOOL_NAME } from "./config.js";

export type ConfigDefaultsResult = { config: OpenClawConfig; changes: string[] };

type LooseConfig = {
  tools?: { allow?: unknown; alsoAllow?: unknown } & Record<string, unknown>;
  agents?: {
    list?: Array<Record<string, unknown> | undefined>;
    defaults?: {
      models?: Record<string, unknown>;
      subagents?: { allowAgents?: unknown };
    } & Record<string, unknown>;
  } & Record<string, unknown>;
  plugins?: { entries?: Record<string, Record<string, unknown>> } & Record<string, unknown>;
} & Record<string, unknown>;

/**
 * Idempotently writes everything the search_subagent tool needs into the user
 * config, so install + `openclaw models auth login` is a complete setup:
 *
 * - allowlists the tool (the default `coding` profile excludes plugin tools),
 * - adds a dedicated read-only `search` agent pinned to Toast-1,
 * - authorizes the plugin's toast-1 model override for fallback spawns.
 *
 * Wired into the provider auth method's `applyConfig` and registered as a
 * config migration. Returns null when the config already has everything.
 */
export function applySearchSubagentDefaults(config: OpenClawConfig): ConfigDefaultsResult | null {
  const cfg = structuredClone(config) as LooseConfig;
  const changes: string[] = [];

  const tools = (cfg.tools ??= {});
  if (Array.isArray(tools.allow)) {
    if (!tools.allow.includes(TOOL_NAME)) {
      tools.allow.push(TOOL_NAME);
      changes.push(`tools.allow: added ${TOOL_NAME}`);
    }
  } else {
    const alsoAllow = Array.isArray(tools.alsoAllow) ? tools.alsoAllow : (tools.alsoAllow = []);
    if (!alsoAllow.includes(TOOL_NAME)) {
      alsoAllow.push(TOOL_NAME);
      changes.push(`tools.alsoAllow: added ${TOOL_NAME}`);
    }
  }

  const agents = (cfg.agents ??= {});
  const agentList = (agents.list ??= []);
  if (!agentList.some((agent) => agent?.id === DEFAULT_SEARCH_AGENT_ID)) {
    agentList.push({
      id: DEFAULT_SEARCH_AGENT_ID,
      name: "Search",
      description: "Read-only local search agent powered by Mixedbread Toast-1.",
      model: DEFAULT_MODEL_REF,
      tools: { allow: ["read", "exec"] },
    });
    changes.push(`agents.list: added ${DEFAULT_SEARCH_AGENT_ID} agent (${DEFAULT_MODEL_REF})`);
  }

  // Only touch restriction lists that already exist — their absence means
  // "no restriction", and creating them would tighten the user's config.
  const defaults = agents.defaults;
  const modelsMap = defaults?.models;
  if (modelsMap && typeof modelsMap === "object" && !Array.isArray(modelsMap) && !(DEFAULT_MODEL_REF in modelsMap)) {
    modelsMap[DEFAULT_MODEL_REF] = {};
    changes.push(`agents.defaults.models: added ${DEFAULT_MODEL_REF}`);
  }
  const allowAgents = defaults?.subagents?.allowAgents;
  if (Array.isArray(allowAgents) && !allowAgents.includes(DEFAULT_SEARCH_AGENT_ID)) {
    allowAgents.push(DEFAULT_SEARCH_AGENT_ID);
    changes.push(`agents.defaults.subagents.allowAgents: added ${DEFAULT_SEARCH_AGENT_ID}`);
  }

  const entries = ((cfg.plugins ??= {}).entries ??= {});
  const entry = (entries[PLUGIN_ID] ??= {});
  if (!entry.subagent) {
    entry.subagent = { allowModelOverride: true, allowedModels: [DEFAULT_MODEL_REF] };
    changes.push(`plugins.entries.${PLUGIN_ID}.subagent: authorized ${DEFAULT_MODEL_REF} override`);
  }

  return changes.length > 0 ? { config: cfg as OpenClawConfig, changes } : null;
}

function removeFromList(list: unknown, value: string): boolean {
  if (!Array.isArray(list)) return false;
  const index = list.indexOf(value);
  if (index === -1) return false;
  list.splice(index, 1);
  return true;
}

/**
 * In-place inverse of {@link applySearchSubagentDefaults}, used by the
 * `openclaw search-subagent teardown` command before `plugins uninstall`.
 * Conservative: the `search` agent is only removed while it still points at a
 * mixedbread model, and provider config / stored credentials are left alone.
 */
export function stripSearchSubagentConfig(cfg: LooseConfig): string[] {
  const changes: string[] = [];

  const tools = cfg.tools;
  if (removeFromList(tools?.allow, TOOL_NAME)) changes.push(`tools.allow: removed ${TOOL_NAME}`);
  if (removeFromList(tools?.alsoAllow, TOOL_NAME)) changes.push(`tools.alsoAllow: removed ${TOOL_NAME}`);
  if (tools && Array.isArray(tools.alsoAllow) && tools.alsoAllow.length === 0) delete tools.alsoAllow;

  const agents = cfg.agents;
  const agentList = agents?.list;
  if (Array.isArray(agentList)) {
    const index = agentList.findIndex(
      (agent) =>
        agent?.id === DEFAULT_SEARCH_AGENT_ID &&
        typeof agent?.model === "string" &&
        agent.model.startsWith(`${PROVIDER_ID}/`),
    );
    if (index !== -1) {
      agentList.splice(index, 1);
      changes.push(`agents.list: removed ${DEFAULT_SEARCH_AGENT_ID} agent`);
    }
  }

  const defaults = agents?.defaults;
  const modelsMap = defaults?.models;
  if (modelsMap && typeof modelsMap === "object" && DEFAULT_MODEL_REF in modelsMap) {
    delete modelsMap[DEFAULT_MODEL_REF];
    changes.push(`agents.defaults.models: removed ${DEFAULT_MODEL_REF}`);
  }
  if (removeFromList(defaults?.subagents?.allowAgents, DEFAULT_SEARCH_AGENT_ID)) {
    changes.push(`agents.defaults.subagents.allowAgents: removed ${DEFAULT_SEARCH_AGENT_ID}`);
  }

  const entry = cfg.plugins?.entries?.[PLUGIN_ID];
  if (entry?.subagent) {
    delete entry.subagent;
    changes.push(`plugins.entries.${PLUGIN_ID}.subagent: removed override authorization`);
  }

  return changes;
}

/** Pure wrapper around {@link stripSearchSubagentConfig}. */
export function removeSearchSubagentDefaults(config: OpenClawConfig): ConfigDefaultsResult | null {
  const cfg = structuredClone(config) as LooseConfig;
  const changes = stripSearchSubagentConfig(cfg);
  return changes.length > 0 ? { config: cfg as OpenClawConfig, changes } : null;
}
