import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "openclaw/plugin-sdk/plugin-entry";
import { applySearchSubagentDefaults, removeSearchSubagentDefaults } from "./setup.js";

describe("applySearchSubagentDefaults", () => {
  it("bootstraps an empty config with allowlist, search agent, and override policy", () => {
    const result = applySearchSubagentDefaults({} as OpenClawConfig);

    expect(result).not.toBeNull();
    const cfg = result!.config as Record<string, any>;
    expect(cfg.tools.alsoAllow).toEqual(["search_subagent"]);
    expect(cfg.agents.list).toEqual([
      expect.objectContaining({
        id: "search",
        model: "mixedbread/toast-1",
        tools: { allow: ["read", "exec"] },
      }),
    ]);
    expect(cfg.plugins.entries["search-subagent"].subagent).toEqual({
      allowModelOverride: true,
      allowedModels: ["mixedbread/toast-1"],
    });
    // absent restriction lists must not be created
    expect(cfg.agents.defaults).toBeUndefined();
    expect(result!.changes).toHaveLength(3);
  });

  it("appends to tools.allow when the config uses an explicit allow list", () => {
    const result = applySearchSubagentDefaults({ tools: { allow: ["read"] } } as OpenClawConfig);

    const cfg = result!.config as Record<string, any>;
    expect(cfg.tools.allow).toEqual(["read", "search_subagent"]);
    expect(cfg.tools.alsoAllow).toBeUndefined();
  });

  it("extends existing model and subagent restriction lists", () => {
    const result = applySearchSubagentDefaults({
      agents: {
        defaults: {
          models: { "claude-cli/claude-opus-4-8": {} },
          subagents: { allowAgents: ["main"] },
        },
        list: [{ id: "main" }],
      },
    } as OpenClawConfig);

    const cfg = result!.config as Record<string, any>;
    expect(cfg.agents.defaults.models).toHaveProperty(["mixedbread/toast-1"]);
    expect(cfg.agents.defaults.subagents.allowAgents).toEqual(["main", "search"]);
  });

  it("is idempotent: a fully configured config returns null", () => {
    const first = applySearchSubagentDefaults({} as OpenClawConfig);
    const second = applySearchSubagentDefaults(first!.config);

    expect(second).toBeNull();
  });

  it("keeps an existing search agent and subagent policy untouched", () => {
    const config = {
      tools: { alsoAllow: ["search_subagent"] },
      agents: { list: [{ id: "search", model: "custom/model" }] },
      plugins: { entries: { "search-subagent": { subagent: { allowModelOverride: false } } } },
    } as unknown as OpenClawConfig;

    expect(applySearchSubagentDefaults(config)).toBeNull();
  });

  it("does not mutate the input config", () => {
    const input = { tools: { alsoAllow: [] } } as unknown as OpenClawConfig;
    applySearchSubagentDefaults(input);

    expect((input as Record<string, any>).tools.alsoAllow).toEqual([]);
    expect((input as Record<string, any>).agents).toBeUndefined();
  });
});

describe("removeSearchSubagentDefaults", () => {
  it("reverts everything applySearchSubagentDefaults wrote", () => {
    const applied = applySearchSubagentDefaults({
      agents: {
        defaults: { models: { "claude-cli/claude-opus-4-8": {} }, subagents: { allowAgents: ["main"] } },
        list: [{ id: "main" }],
      },
    } as OpenClawConfig)!.config;

    const removed = removeSearchSubagentDefaults(applied);

    expect(removed).not.toBeNull();
    const cfg = removed!.config as Record<string, any>;
    expect(cfg.tools.alsoAllow).toBeUndefined();
    expect(cfg.agents.list).toEqual([{ id: "main" }]);
    expect(cfg.agents.defaults.models).toEqual({ "claude-cli/claude-opus-4-8": {} });
    expect(cfg.agents.defaults.subagents.allowAgents).toEqual(["main"]);
    expect(cfg.plugins.entries["search-subagent"].subagent).toBeUndefined();
    expect(removeSearchSubagentDefaults(removed!.config)).toBeNull();
  });

  it("returns null when there is nothing to revert", () => {
    expect(removeSearchSubagentDefaults({} as OpenClawConfig)).toBeNull();
  });

  it("keeps a search agent the user re-pointed to another provider", () => {
    const result = removeSearchSubagentDefaults({
      agents: { list: [{ id: "search", model: "anthropic/claude-sonnet-5" }] },
      tools: { alsoAllow: ["search_subagent"] },
    } as unknown as OpenClawConfig);

    const cfg = result!.config as Record<string, any>;
    expect(cfg.agents.list).toEqual([{ id: "search", model: "anthropic/claude-sonnet-5" }]);
    expect(cfg.tools.alsoAllow).toBeUndefined();
  });
});
