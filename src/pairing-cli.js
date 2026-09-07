import fs from "node:fs";
import path from "node:path";
import { pair } from "./api.js";
import { CHANNEL_ID, DEFAULT_ACCOUNT_ID, DEFAULT_SERVER_URL, credentialPath } from "./config.js";

export function registerPairingCli(ctx, runtime) {
  const root = ctx.program.command(CHANNEL_ID).description("Manage Silverpine Chat pairing");
  root.command("pair")
    .requiredOption("--code <code>", "One-time pairing code")
    .option("--server-url <url>", "Silverpine Chat server URL", DEFAULT_SERVER_URL)
    .option("--account <id>", "OpenClaw channel account", DEFAULT_ACCOUNT_ID)
    .option("--label <label>", "Credential label", "OpenClaw")
    .action(async (options) => {
      const result = await pair(options.serverUrl, options.code, options.label);
      const file = credentialPath(options.account);
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
      await runtime.config.mutateConfigFile({
        afterWrite: { mode: "restart", reason: "Silverpine Chat pairing updated" },
        mutate(draft) {
          draft.channels ??= {};
          draft.channels[CHANNEL_ID] = {
            ...(draft.channels[CHANNEL_ID] || {}),
            enabled: true,
            serverUrl: options.serverUrl.replace(/\/$/, ""),
            credentialFile: file
          };
        }
      });
      process.stdout.write(`Paired Silverpine Chat bot ${result.botId} for group ${result.groupId}.\n`);
    });
}
