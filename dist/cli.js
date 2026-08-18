import { PLUGIN_ID, PROVIDER_ID } from "./config.js";
import { removeSearchSubagentDefaults, stripSearchSubagentConfig } from "./setup.js";
/**
 * Registers `openclaw search-subagent teardown [--dry-run]` — the uninstall
 * counterpart of the auto-configuration: it reverts what
 * `applySearchSubagentDefaults` wrote, then points at `plugins uninstall`
 * for the rest (which removes the plugin entry, files, and load path).
 */
export function registerSearchSubagentCli(api) {
    api.registerCli(({ program, config, logger }) => {
        const root = program.command(PLUGIN_ID).description("Mixedbread search subagent commands");
        root
            .command("teardown")
            .description("Revert config written by this plugin (run before `openclaw plugins uninstall search-subagent`)")
            .option("--dry-run", "show what would change without writing", false)
            .action(async (opts) => {
            const preview = removeSearchSubagentDefaults(config);
            if (!preview) {
                logger.info("Nothing to revert — no plugin-written config found.");
            }
            else if (opts.dryRun) {
                logger.info(`Would revert:\n- ${preview.changes.join("\n- ")}`);
            }
            else {
                let changes = [];
                await api.runtime.config.mutateConfigFile({
                    afterWrite: { mode: "auto" },
                    mutate(draft) {
                        changes = stripSearchSubagentConfig(draft);
                    },
                });
                logger.info(changes.length > 0 ? `Reverted:\n- ${changes.join("\n- ")}` : "Nothing to revert.");
            }
            const leftovers = [];
            if (config.models?.providers?.[PROVIDER_ID]) {
                leftovers.push(`models.providers.${PROVIDER_ID} (may be used elsewhere — remove manually if unwanted)`);
            }
            if (process.env.MIXEDBREAD_API_KEY) {
                leftovers.push("MIXEDBREAD_API_KEY in the environment / config env block");
            }
            if (leftovers.length > 0)
                logger.info(`Left in place:\n- ${leftovers.join("\n- ")}`);
            logger.info("Finish with: openclaw plugins uninstall search-subagent && openclaw gateway restart");
        });
    }, { commands: [PLUGIN_ID] });
}
