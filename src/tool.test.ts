import { describe, expect, it } from "vitest";
import type { OpenClawPluginApi, OpenClawPluginToolContext } from "openclaw/plugin-sdk/plugin-entry";
import { parsePluginConfig } from "./config.js";
import {
  extractAssistantReply,
  extractCliAgentReply,
  isSubagentRuntimeUnavailableError,
  registerSearchSubagentTool,
  splitModelRef,
  TOOL_NAME,
  type CliAgentRunner,
} from "./tool.js";

type ExecutableTool = {
  name: string;
  description: string;
  execute: (toolCallId: string, params: unknown) => Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }>;
};

type SubagentCalls = {
  run: Array<Record<string, unknown>>;
  wait: Array<Record<string, unknown>>;
  getMessages: Array<Record<string, unknown>>;
};

function buildTool(options?: {
  waitStatus?: "ok" | "error" | "timeout";
  messages?: unknown[];
  pluginConfig?: Record<string, unknown>;
  toolCtx?: Partial<OpenClawPluginToolContext>;
  runtimeUnavailable?: boolean;
  cliRunner?: CliAgentRunner;
}) {
  const calls: SubagentCalls = { run: [], wait: [], getMessages: [] };
  const factories: Array<(ctx: OpenClawPluginToolContext) => ExecutableTool> = [];
  const api = {
    registerTool(factory: (ctx: OpenClawPluginToolContext) => ExecutableTool) {
      factories.push(factory);
    },
    runtime: {
      subagent: {
        async run(params: Record<string, unknown>) {
          if (options?.runtimeUnavailable) {
            throw new Error("Plugin runtime subagent methods are only available during a gateway request.");
          }
          calls.run.push(params);
          return { runId: "run-1" };
        },
        async waitForRun(params: Record<string, unknown>) {
          calls.wait.push(params);
          return { status: options?.waitStatus ?? "ok" };
        },
        async getSessionMessages(params: Record<string, unknown>) {
          calls.getMessages.push(params);
          return { messages: options?.messages ?? [] };
        },
      },
    },
  } as unknown as OpenClawPluginApi;

  registerSearchSubagentTool(api, parsePluginConfig(options?.pluginConfig), options?.cliRunner);
  const ctx = {
    agentId: "main",
    workspaceDir: "/tmp/workspace",
    config: { agents: { list: [{ id: "main" }, { id: "search" }] } },
    ...options?.toolCtx,
  } as OpenClawPluginToolContext;
  return { tool: factories[0]!(ctx), calls };
}

const assistantReply = [
  { role: "user", content: "Search task: find retries" },
  { role: "assistant", content: [{ type: "thinking", thinking: "…" }, { type: "text", text: "Found it: src/http.ts:12 `maxRetries = 3`" }] },
];

describe(TOOL_NAME, () => {
  it("spawns a subagent on the search agent without a model override", async () => {
    const { tool, calls } = buildTool({ messages: assistantReply });

    const result = await tool.execute("call-1", { task: "find retries" });

    expect(calls.run).toHaveLength(1);
    const run = calls.run[0]!;
    expect(run.sessionKey).toMatch(/^agent:search:subagent:[0-9a-f-]{36}$/);
    // The search agent pins its own model; overrides are policy-gated.
    expect(run.provider).toBeUndefined();
    expect(run.model).toBeUndefined();
    expect(run.deliver).toBe(false);
    expect(run.cwd).toBe("/tmp/workspace");
    expect(run.message).toContain("find retries");
    expect(calls.wait[0]).toMatchObject({ runId: "run-1", timeoutMs: 180_000 });
    expect(result.content[0]?.text).toContain("src/http.ts:12");
    expect(result.details).toMatchObject({ transport: "runtime", agentId: "search" });
  });

  it("falls back to the calling agent with a toast-1 override when the search agent is not configured", async () => {
    const { tool, calls } = buildTool({
      messages: assistantReply,
      toolCtx: { config: { agents: { list: [{ id: "main" }] } } } as Partial<OpenClawPluginToolContext>,
    });

    await tool.execute("call-1", { task: "find retries" });

    expect(calls.run[0]?.sessionKey).toMatch(/^agent:main:subagent:/);
    expect(calls.run[0]).toMatchObject({ provider: "mixedbread", model: "toast-1" });
  });

  it("honors explicit path and model overrides", async () => {
    const { tool, calls } = buildTool({ messages: assistantReply });

    await tool.execute("call-1", { task: "find retries", path: "/repo/src", model: "mixedbread/toast-1" });

    expect(calls.run[0]).toMatchObject({ provider: "mixedbread", model: "toast-1", cwd: "/repo/src" });
    expect(calls.run[0]?.message).toContain("/repo/src");
  });

  it("throws when the subagent run times out", async () => {
    const { tool } = buildTool({ waitStatus: "timeout" });

    await expect(tool.execute("call-1", { task: "find retries" })).rejects.toThrow(/timed out after 180s/);
  });

  it("throws when the subagent run fails", async () => {
    const { tool } = buildTool({ waitStatus: "error" });

    await expect(tool.execute("call-1", { task: "find retries" })).rejects.toThrow(/failed/);
  });

  it("falls back to the openclaw CLI when the runtime subagent is unavailable", async () => {
    const cliCalls: string[][] = [];
    const cliRunner: CliAgentRunner = async (args) => {
      cliCalls.push(args);
      return JSON.stringify({ result: { payloads: [{ text: "CLI result: src/http.ts:12" }] } });
    };
    const { tool } = buildTool({ runtimeUnavailable: true, cliRunner });

    const result = await tool.execute("call-1", { task: "find retries" });

    expect(cliCalls).toHaveLength(1);
    const args = cliCalls[0]!;
    expect(args[0]).toBe("agent");
    expect(args).toContain("--agent");
    expect(args).toContain("search");
    expect(args).not.toContain("--model");
    expect(result.content[0]?.text).toContain("CLI result: src/http.ts:12");
    expect(result.details).toMatchObject({ transport: "cli" });
  });
});

describe("isSubagentRuntimeUnavailableError", () => {
  it("matches the runtime scope error by code and message", () => {
    const coded = Object.assign(new Error("nope"), { code: "OPENCLAW_SUBAGENT_RUNTIME_REQUEST_SCOPE" });
    expect(isSubagentRuntimeUnavailableError(coded)).toBe(true);
    expect(
      isSubagentRuntimeUnavailableError(
        new Error("Plugin runtime subagent methods are only available during a gateway request."),
      ),
    ).toBe(true);
    expect(isSubagentRuntimeUnavailableError(new Error("boom"))).toBe(false);
  });
});

describe("extractCliAgentReply", () => {
  it("prefers payload texts and falls back to finalAssistantRawText", () => {
    expect(
      extractCliAgentReply('log line\n{"result":{"payloads":[{"text":"hit: a.ts:1"}]}}'),
    ).toBe("hit: a.ts:1");
    expect(
      extractCliAgentReply('{"result":{"turn":{"finalAssistantRawText":"raw answer"}}}'),
    ).toBe("raw answer");
    expect(extractCliAgentReply("not json")).toBeUndefined();
  });
});

describe("splitModelRef", () => {
  it("splits provider/model refs and defaults bare ids to the fallback provider", () => {
    expect(splitModelRef("mixedbread/toast-1", "mixedbread")).toEqual({ provider: "mixedbread", model: "toast-1" });
    expect(splitModelRef("other/model-x", "mixedbread")).toEqual({ provider: "other", model: "model-x" });
    expect(splitModelRef("toast-1", "mixedbread")).toEqual({ provider: "mixedbread", model: "toast-1" });
  });
});

describe("extractAssistantReply", () => {
  it("returns the last assistant text, skipping non-text parts", () => {
    expect(extractAssistantReply(assistantReply)).toBe("Found it: src/http.ts:12 `maxRetries = 3`");
  });

  it("handles string content and empty transcripts", () => {
    expect(extractAssistantReply([{ role: "assistant", content: "plain answer" }])).toBe("plain answer");
    expect(extractAssistantReply([])).toBeUndefined();
    expect(extractAssistantReply([{ role: "user", content: "hi" }])).toBeUndefined();
  });
});
