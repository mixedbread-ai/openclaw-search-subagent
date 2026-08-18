# AGENT.md — mixedbread-openclaw-search-subagent

Guide for agents (and humans) working on this repo.

## What this is

An OpenClaw native plugin (id `search-subagent`) that registers:

- the `mixedbread` model provider (Toast-1, OpenAI-completions transport), and
- the `search_subagent` agent tool, which delegates local grep searches to a
  Toast-1 subagent session.

Target host: OpenClaw `>= 2026.7.1-2`. The SDK surface is typed — the host's
`dist/*.d.ts` files (in `node_modules/openclaw`) are the source of truth, not
memory or blog posts.

## Layout

```
openclaw.plugin.json   # manifest: id, providers, contracts.tools, setup, configSchema
package.json           # openclaw.extensions entry point + build/compat metadata
setup-api.ts           # setup-surface entry: provider auth discovery, config migration, auto-enable
src/index.ts           # definePluginEntry → wires provider + tool + CLI + migration
src/config.ts          # plugin config parsing + shared constants
src/provider.ts        # registerProvider: auth method (applyConfig defaults) + catalog (toast-1)
src/setup.ts           # apply/remove config defaults (idempotent, both directions)
src/cli.ts             # `openclaw search-subagent teardown` (uninstall counterpart)
src/tool.ts            # registerTool factory: spawn subagent, extract reply, CLI fallback
src/*.test.ts          # vitest unit tests (mock OpenClawPluginApi)
```

## Commands

```bash
npm install        # deps incl. openclaw (types) — large but cached
npm test           # vitest, no network
npm run build      # tsc → dist/  (the plugin loader executes dist/index.js)
npm run validate   # build + clawhub package validate
```

Local integration loop (requires an OpenClaw gateway on this machine):

```bash
openclaw plugins install --link . && openclaw plugins enable search-subagent
npm run build && openclaw gateway restart        # ALWAYS rebuild before restart
openclaw plugins inspect search-subagent --runtime --json   # status: loaded?
openclaw agent --session-key "agent:main:t-$(date +%s)" \
  -m "Use the search_subagent tool with task: 'find X'" --json
```

Use a **fresh `--session-key` per test** — reusing a session lets the model
answer from conversation history without re-calling the tool.

## Hard-won facts about the host (2026.7.1-2)

These cost real debugging time; don't relearn them:

1. **`contracts.tools` in the manifest is mandatory.** Plugins are selected for
   tool loading from `plugin.contracts.tools` (see
   `resolvePluginToolRuntimePluginIds` in the host). No manifest declaration →
   the runtime `registerTool` is never surfaced, silently.
2. **The `coding` tools profile excludes plugin tools.** Users must add the
   tool via `tools.alsoAllow` (name, plugin id, or `group:plugins` all work).
3. **`api.runtime.subagent.*` binds only inside the Gateway process.**
   Tool calls bridged through a CLI backend (claude-cli / Claude Code MCP
   bridge) execute in a separate process and throw
   `OPENCLAW_SUBAGENT_RUNTIME_REQUEST_SCOPE`. `src/tool.ts` catches this and
   falls back to spawning `openclaw agent --agent search --session-key
   agent:<id>:subagent:<uuid>` — verified working end-to-end.
   (`sessions_spawn` is NOT a substitute: its child inherits the CLI harness's
   tool ceiling and ends with "No callable tools remain".)
4. **Plugin subagent model overrides are policy-gated** via
   `plugins.entries.<id>.subagent.allowModelOverride` / `allowedModels`.
   The tool avoids sending an override when the target `search` agent already
   pins Toast-1.
5. **Tool names are global.** A second plugin registering `search_subagent`
   logs `plugin tool name conflict` in doctor and the first registration wins.
   An older experiment at
   `~/projects/potential-candidates/plugins-dev/mixedbread-search` had the
   same tool name and provider `mixedbread-search`; it is superseded by this
   plugin and should stay disabled.
6. **Don't trust the model's self-reported tool list.** To know what the model
   really sees, add a temporary `normalizeToolSchemas(ctx)` hook on the
   provider and log `ctx.tools.map(t => t.name)`.
7. The linked-plugin loader executes **`dist/index.js`** (not `src/index.ts`),
   so every code change needs `npm run build` + `openclaw gateway restart`.
8. **Setup flows do not load the main extension.** `openclaw doctor`,
   onboarding, auth-provider discovery, config migrations, and auto-enable
   probes execute the root-level **`setup-api.ts`** entry (loaded by filename
   convention) with a metadata-only API. `api.registerConfigMigration` /
   `registerAutoEnableProbe` calls in the main entry are invisible there —
   register them in `setup-api.ts` too. The api-key auth method's
   `applyConfig` hook runs on `models auth login` success and is the primary
   zero-config path; doctor's migration pass is the fallback. Verified on a
   fresh isolated profile (`openclaw --profile <name>`), which is also the
   cleanest way to test install UX end to end.

## Conventions

- Strict TypeScript, `module: NodeNext` — relative imports use `.js` suffix.
- SDK imports use focused subpaths (`openclaw/plugin-sdk/plugin-entry`,
  `.../provider-auth-api-key`, `.../provider-catalog-shared`); TypeBox comes
  from the `typebox` package (v1, matching the host).
- Tools: throw on infra failure; return `{ content: [{type:"text",...}],
  details }` on success. Keep helpers (`extractAssistantReply`,
  `extractCliAgentReply`, `splitModelRef`) exported for unit tests.
- Never commit API keys; the sample key in local configs is the user's real
  key. Config lives in `~/.openclaw/openclaw.json`, not in this repo.

## Release

ClawHub packs from the **GitHub repo at `main`** (github:mixedbread-ai/openclaw-search-subagent),
not the local working tree, and requires compiled runtime output — which is
why `dist/` is committed (CI fails if it drifts from `src/`). To release:

1. Bump `version` in both `package.json` and `openclaw.plugin.json`.
2. `npm test && npm run build`, commit (including `dist/`), push.
3. `clawhub package publish mixedbread-ai/openclaw-search-subagent --dry-run`, then without `--dry-run`.
