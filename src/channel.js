import { randomUUID } from "node:crypto";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { createMessageReceiptFromOutboundResults, defineChannelMessageAdapter } from "openclaw/plugin-sdk/channel-outbound";
import { sendText } from "./api.js";
import { CHANNEL_ID, DEFAULT_ACCOUNT_ID, resolveAccount } from "./config.js";
import { startGateway } from "./gateway.js";

const meta = {
  id: CHANNEL_ID,
  label: "Silverpine Chat",
  selectionLabel: "Silverpine Chat",
  detailLabel: "Silverpine Chat Bot",
  docsPath: "/channels/silverpine-chat",
  blurb: "Connect OpenClaw agents to Silverpine Chat.",
  markdownCapable: true
};

async function outbound(ctx) {
  const account = resolveAccount(ctx.cfg, ctx.accountId || DEFAULT_ACCOUNT_ID);
  const result = await sendText(account, ctx.to, ctx.text, ctx.clientMessageId || randomUUID());
  return { channel: CHANNEL_ID, messageId: result.id };
}

const message = defineChannelMessageAdapter({
  id: CHANNEL_ID,
  durableFinal: { capabilities: { text: true } },
  send: {
    text: async (ctx) => {
      const result = await outbound(ctx);
      return {
        messageId: result.messageId,
        receipt: createMessageReceiptFromOutboundResults({ results: [result], kind: "text" })
      };
    }
  }
});

export const silverpineChatPlugin = createChatChannelPlugin({
  base: {
    id: CHANNEL_ID,
    meta,
    capabilities: { chatTypes: ["group"] },
    reload: { configPrefixes: [`channels.${CHANNEL_ID}`] },
    config: {
      listAccountIds: () => [DEFAULT_ACCOUNT_ID],
      defaultAccountId: () => DEFAULT_ACCOUNT_ID,
      resolveAccount: (cfg, accountId) => resolveAccount(cfg, accountId || DEFAULT_ACCOUNT_ID),
      isEnabled: (account) => account.enabled,
      isConfigured: (account) => account.configured,
      resolveDefaultTo: ({ cfg, accountId }) => resolveAccount(cfg, accountId).defaultTo,
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        tokenSource: account.credentialFile
      })
    },
    gateway: { startAccount: startGateway },
    messaging: {
      normalizeTarget: (target) => String(target || "").trim(),
      inferTargetChatType: () => "group",
      targetResolver: { looksLikeId: (raw) => /^(channel:|conversation:)?[a-z0-9_-]+$/i.test(raw.trim()), hint: "channel:<id>" },
      resolveSessionConversation: ({ rawId }) => ({ id: rawId, baseConversationId: rawId, parentConversationCandidates: [rawId] })
    },
    message
  },
  outbound: {
    base: { deliveryMode: "direct", sendTextOnlyErrorPayloads: true },
    attachedResults: { channel: CHANNEL_ID, sendText: outbound }
  }
});
