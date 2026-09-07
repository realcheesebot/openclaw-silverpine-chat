import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { silverpineChatPlugin } from "./src/channel.js";
import { registerPairingCli } from "./src/pairing-cli.js";

export default defineChannelPluginEntry({
  id: "silverpine-chat",
  name: "Silverpine Chat",
  description: "Silverpine Chat channel plugin",
  plugin: silverpineChatPlugin,
  registerCliMetadata(api) {
    api.registerCli((ctx) => registerPairingCli(ctx, api.runtime), {
      commands: ["silverpine-chat"],
      descriptors: [
        { name: "silverpine-chat", description: "Manage Silverpine Chat pairing", hasSubcommands: true }
      ]
    });
  }
});
