import { buildChannelInboundEventContext } from "openclaw/plugin-sdk/channel-inbound";
import { resolveInboundRouteEnvelopeBuilderWithRuntime } from "openclaw/plugin-sdk/inbound-envelope";
import { sendText } from "./api.js";
import { CHANNEL_ID } from "./config.js";

export function isDispatchableMessage(event, account) {
  if (event?.type !== "message.created" || !event.data?.id || !event.data?.text) return false;
  if (!account.respondToBots && event.data.sender?.isBot) return false;
  if (event.data.sender?.id === account.credential?.botUserId) return false;
  return event.data.containerType === "channel" || event.data.containerType === "conversation";
}

export async function dispatchMessage({ event, account, cfg, channelRuntime }) {
  if (!isDispatchableMessage(event, account)) return false;
  const dispatchReply = channelRuntime?.reply?.dispatchReplyWithBufferedBlockDispatcher;
  if (typeof dispatchReply !== "function") {
    throw new Error("OpenClaw channel reply dispatcher is unavailable");
  }
  const data = event.data;
  const kind = data.containerType === "conversation" ? "conversation" : "channel";
  const target = `${kind}:${data.containerId}`;
  const { route, buildEnvelope } = resolveInboundRouteEnvelopeBuilderWithRuntime({
    cfg,
    channel: CHANNEL_ID,
    accountId: account.accountId,
    peer: { kind: kind === "channel" ? "channel" : "group", id: target },
    runtime: channelRuntime
  });
  const senderName = data.sender?.displayName || data.sender?.preferredUsername || data.sender?.id || "Unknown";
  const body = buildEnvelope({
    channel: "Silverpine Chat",
    from: senderName,
    timestamp: Date.parse(data.createdAt || event.occurredAt || new Date().toISOString()),
    body: data.text
  });
  const ctxPayload = buildChannelInboundEventContext({
    channel: CHANNEL_ID,
    accountId: account.accountId,
    messageId: data.id,
    messageIdFull: data.id,
    timestamp: Date.parse(data.createdAt || event.occurredAt || new Date().toISOString()),
    from: target,
    sender: { id: data.sender?.id || "unknown", name: senderName },
    conversation: {
      kind: "group",
      id: data.containerId,
      label: data.containerId,
      nativeChannelId: data.containerId
    },
    route: {
      agentId: route.agentId,
      dmScope: route.dmScope,
      accountId: route.accountId,
      routeSessionKey: route.sessionKey,
      dispatchSessionKey: route.sessionKey
    },
    reply: { to: target, originatingTo: target },
    message: { body, bodyForAgent: data.text, rawBody: data.text, commandBody: data.text },
    access: { commands: { authorized: true }, mentions: { canDetectMention: false, wasMentioned: false } },
    extra: { GroupSubject: data.containerId, GroupChannel: data.containerId }
  });
  await dispatchReply({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      deliver: async (payload) => {
        const text = typeof payload?.text === "string"
          ? payload.text.trim()
          : typeof payload?.body === "string"
            ? payload.body.trim()
            : "";
        if (text) await sendText(account, target, text);
      }
    },
    replyOptions: {}
  });
  return true;
}
