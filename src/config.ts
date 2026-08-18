export const PLUGIN_ID = "search-subagent";
export const TOOL_NAME = "search_subagent";
export const PROVIDER_ID = "mixedbread";
export const DEFAULT_MODEL_ID = "toast-1";
export const DEFAULT_MODEL_REF = `${PROVIDER_ID}/${DEFAULT_MODEL_ID}`;
export const DEFAULT_BASE_URL = "https://api.mixedbread.com/v1";
export const DEFAULT_SEARCH_AGENT_ID = "search";
export const DEFAULT_TIMEOUT_SECONDS = 180;

export type SearchSubagentConfig = {
  baseUrl: string;
  apiKey?: string;
  agentId: string;
  timeoutSeconds: number;
};

function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readPositiveNumber(source: Record<string, unknown>, key: string): number | undefined {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Normalizes the raw `plugins.entries.search-subagent.config` block. */
export function parsePluginConfig(raw: Record<string, unknown> | undefined): SearchSubagentConfig {
  const source = raw ?? {};
  return {
    baseUrl: readString(source, "baseUrl") ?? DEFAULT_BASE_URL,
    apiKey: readString(source, "apiKey"),
    agentId: readString(source, "agentId") ?? DEFAULT_SEARCH_AGENT_ID,
    timeoutSeconds: readPositiveNumber(source, "timeoutSeconds") ?? DEFAULT_TIMEOUT_SECONDS,
  };
}
