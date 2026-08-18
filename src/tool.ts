import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Type } from "typebox";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_MODEL_ID, PROVIDER_ID, TOOL_NAME, type SearchSubagentConfig } from "./config.js";

export { TOOL_NAME };

const SEARCH_SYSTEM_PROMPT = [
  "You are a read-only search subagent. Answer the search task by searching",
  "the local filesystem with ripgrep/grep through the exec tool.",
  "",
  "Rules:",
  "- Prefer ripgrep: `rg -n -S --hidden <pattern> <path>` (fall back to `grep -rn`).",
  "- Never modify files and never run commands with side effects.",
  "- Iterate on patterns; read matching files when you need surrounding context.",
  "- Reply with concise findings: `path:line` references, a short snippet per",
  "  match, and a one-line summary at the top.",
  "- If nothing matches, say so and list the patterns you tried.",
].join("\n");

const parameters = Type.Object({
  task: Type.String({
    description: "Search task in natural language, e.g. 'find where retries are configured for the HTTP client'.",
  }),
  path: Type.Optional(
    Type.String({
      description: "Directory to search. Defaults to the calling agent's workspace.",
    }),
  ),
  model: Type.Optional(
    Type.String({
      description: "Model override as provider/model or bare model id. Defaults to mixedbread/toast-1.",
    }),
  ),
});

type SearchSubagentParams = {
  task: string;
  path?: string;
  model?: string;
};

/** Runs `openclaw <args>` and resolves with stdout. Used when the in-process runtime is unavailable. */
export type CliAgentRunner = (args: string[], timeoutMs: number) => Promise<string>;

const defaultCliAgentRunner: CliAgentRunner = (args, timeoutMs) =>
  new Promise((resolve, reject) => {
    execFile(
      "openclaw",
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(`openclaw agent CLI failed: ${stderr.trim() || error.message}`));
          return;
        }
        resolve(stdout);
      },
    );
  });

export function splitModelRef(ref: string, fallbackProvider: string): { provider: string; model: string } {
  const separator = ref.indexOf("/");
  if (separator > 0 && separator < ref.length - 1) {
    return { provider: ref.slice(0, separator), model: ref.slice(separator + 1) };
  }
  return { provider: fallbackProvider, model: ref };
}

function renderMessageContent(content: unknown): string | undefined {
  if (typeof content === "string") {
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const part of content) {
      if (
        part &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        parts.push((part as { text: string }).text);
      }
    }
    const joined = parts.join("\n").trim();
    return joined.length > 0 ? joined : undefined;
  }
  return undefined;
}

/** Returns the text of the last assistant message in a subagent transcript. */
export function extractAssistantReply(messages: unknown[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as { role?: unknown; content?: unknown } | undefined;
    if (!message || message.role !== "assistant") continue;
    const text = renderMessageContent(message.content);
    if (text) return text;
  }
  return undefined;
}

function findFirstValue(node: unknown, key: string): unknown {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findFirstValue(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (node && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (key in record) return record[key];
    for (const value of Object.values(record)) {
      const found = findFirstValue(value, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Extracts the assistant reply from `openclaw agent --json` output. */
export function extractCliAgentReply(stdout: string): string | undefined {
  const start = stdout.indexOf("{");
  if (start === -1) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
  const payloads = findFirstValue(parsed, "payloads");
  if (Array.isArray(payloads)) {
    const texts = payloads
      .map((payload) => (payload as { text?: unknown } | undefined)?.text)
      .filter((text): text is string => typeof text === "string" && text.trim().length > 0);
    if (texts.length > 0) return texts.join("\n").trim();
  }
  const rawText = findFirstValue(parsed, "finalAssistantRawText");
  if (typeof rawText === "string" && rawText.trim().length > 0) return rawText.trim();
  return undefined;
}

/**
 * The in-process subagent runtime only binds inside the Gateway process. Tool
 * calls bridged through a CLI backend (for example claude-cli) execute in a
 * separate process and must fall back to the `openclaw agent` CLI instead.
 */
export function isSubagentRuntimeUnavailableError(error: unknown): boolean {
  if ((error as { code?: unknown } | undefined)?.code === "OPENCLAW_SUBAGENT_RUNTIME_REQUEST_SCOPE") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("only available during a gateway request");
}

function resolveTargetAgentId(ctx: OpenClawPluginToolContext, config: SearchSubagentConfig): string {
  const cfg = ctx.getRuntimeConfig?.() ?? ctx.runtimeConfig ?? ctx.config;
  const agents = (cfg as { agents?: { list?: Array<{ id?: unknown }> } } | undefined)?.agents?.list ?? [];
  const configured = new Set(agents.map((agent) => agent?.id).filter((id): id is string => typeof id === "string"));
  if (configured.has(config.agentId)) return config.agentId;
  return ctx.agentId ?? "main";
}

export function registerSearchSubagentTool(
  api: OpenClawPluginApi,
  config: SearchSubagentConfig,
  runCliAgent: CliAgentRunner = defaultCliAgentRunner,
): void {
  api.registerTool((ctx) => ({
    name: TOOL_NAME,
    label: "Search Subagent",
    description:
      "Delegate a local file/code search to a Mixedbread Toast-1 subagent. " +
      "The subagent greps the workspace (ripgrep/grep, read-only) and returns matching " +
      "files with line numbers, snippets, and a summary. Use it instead of searching yourself.",
    parameters,
    async execute(_toolCallId, rawParams) {
      const params = rawParams as SearchSubagentParams;
      const task = params.task?.trim();
      if (!task) throw new Error("search_subagent requires a non-empty `task`.");

      const { provider, model } = params.model
        ? splitModelRef(params.model.trim(), PROVIDER_ID)
        : { provider: PROVIDER_ID, model: DEFAULT_MODEL_ID };
      const targetAgentId = resolveTargetAgentId(ctx, config);
      const sessionKey = `agent:${targetAgentId}:subagent:${randomUUID()}`;
      const searchRoot = params.path ?? ctx.workspaceDir;
      const message = searchRoot ? `Search task: ${task}\nSearch root: ${searchRoot}` : `Search task: ${task}`;
      const timeoutMs = config.timeoutSeconds * 1000;
      // The dedicated search agent already pins the search model, and plugin
      // subagent model overrides are policy-gated (plugins.entries.<id>.subagent),
      // so only send an override when the target agent needs one.
      const needsModelOverride = Boolean(params.model) || targetAgentId !== config.agentId;

      let reply: string | undefined;
      let transport: "runtime" | "cli" = "runtime";
      let runId: string | undefined;
      try {
        const spawned = await api.runtime.subagent.run({
          sessionKey,
          message,
          ...(needsModelOverride ? { provider, model } : {}),
          extraSystemPrompt: SEARCH_SYSTEM_PROMPT,
          lane: "subagent",
          lightContext: true,
          deliver: false,
          ...(searchRoot ? { cwd: searchRoot } : {}),
        });
        runId = spawned.runId;

        const wait = await api.runtime.subagent.waitForRun({ runId, timeoutMs });
        if (wait.status === "timeout") {
          throw new Error(
            `Search subagent timed out after ${config.timeoutSeconds}s (session ${sessionKey}). ` +
              "Raise plugins.entries.search-subagent.config.timeoutSeconds or narrow the task.",
          );
        }
        if (wait.status === "error") {
          throw new Error(`Search subagent failed (session ${sessionKey}): ${wait.error ?? "unknown error"}`);
        }

        const { messages } = await api.runtime.subagent.getSessionMessages({ sessionKey });
        reply = extractAssistantReply(messages);
      } catch (error) {
        if (!isSubagentRuntimeUnavailableError(error)) throw error;
        api.logger?.info?.(`[${TOOL_NAME}] runtime subagent unavailable in this process; falling back to the openclaw CLI`);
        transport = "cli";
        const stdout = await runCliAgent(
          [
            "agent",
            "--agent",
            targetAgentId,
            "--session-key",
            sessionKey,
            ...(needsModelOverride ? ["--model", `${provider}/${model}`] : []),
            "-m",
            `${SEARCH_SYSTEM_PROMPT}\n\n${message}`,
            "--json",
            "--timeout",
            String(config.timeoutSeconds),
          ],
          timeoutMs + 30_000,
        );
        reply = extractCliAgentReply(stdout);
      }

      return {
        content: [
          {
            type: "text",
            text: reply ?? `Search subagent finished without a reply (session ${sessionKey}).`,
          },
        ],
        details: {
          sessionKey,
          runId,
          transport,
          agentId: targetAgentId,
          ...(needsModelOverride ? { provider, model } : {}),
          searchRoot,
        },
      };
    },
  }));
}
