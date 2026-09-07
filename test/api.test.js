import test from "node:test";
import assert from "node:assert/strict";
import { dispatchMessage, isDispatchableMessage } from "../src/inbound.js";
import { parseTarget } from "../src/api.js";
import { INBOUND_DISPATCH_CLOSE_CODE } from "../src/gateway.js";

test("WebSocket dispatch failures use an application close code accepted by Node", () => {
  assert.ok(INBOUND_DISPATCH_CLOSE_CODE >= 3000 && INBOUND_DISPATCH_CLOSE_CODE <= 4999);
});

test("target parser supports explicit and bare channel IDs", () => {
  assert.deepEqual(parseTarget("channel:chn_1"), { kind: "channel", id: "chn_1" });
  assert.deepEqual(parseTarget("conversation:cnv_1"), { kind: "conversation", id: "cnv_1" });
  assert.deepEqual(parseTarget("chn_2"), { kind: "channel", id: "chn_2" });
});

test("inbound filter accepts human channel messages and prevents bot loops", () => {
  const account = { respondToBots: false, credential: { botUserId: "bot-user" } };
  const base = { type: "message.created", data: { id: "m1", text: "hello", containerType: "channel", containerId: "c1" } };
  assert.equal(isDispatchableMessage({ ...base, data: { ...base.data, sender: { id: "human", isBot: false } } }, account), true);
  assert.equal(isDispatchableMessage({ ...base, data: { ...base.data, sender: { id: "other-bot", isBot: true } } }, account), false);
  assert.equal(isDispatchableMessage({ ...base, data: { ...base.data, sender: { id: "bot-user", isBot: false } } }, account), false);
});

test("human channel event dispatches to OpenClaw and delivers its reply", async () => {
  const originalFetch = globalThis.fetch;
  let sentBody;
  globalThis.fetch = async (_url, options) => {
    sentBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: "reply-1" }), { status: 201, headers: { "content-type": "application/json" } });
  };
  const account = {
    accountId: "default",
    serverUrl: "https://chat.example",
    respondToBots: false,
    credential: { token: "spchat_bot_test", botUserId: "bot-user" }
  };
  let dispatched = false;
  const channelRuntime = {
    routing: { resolveAgentRoute: () => ({ agentId: "main", accountId: "default", sessionKey: "agent:main:test", mainSessionKey: "agent:main:main", lastRoutePolicy: "session", dmScope: "per-peer" }) },
    session: { resolveStorePath: () => "/tmp/test-sessions.json", readSessionUpdatedAt: () => undefined },
    reply: { resolveEnvelopeFormatOptions: () => ({}), formatAgentEnvelope: ({ body }) => body },
    inbound: {
      dispatch: async (params) => {
        dispatched = true;
        assert.equal(params.ctxPayload.BodyForAgent, "ping");
        await params.delivery.deliver({ text: "pong" });
      }
    }
  };
  try {
    const handled = await dispatchMessage({
      account,
      cfg: {},
      channelRuntime,
      event: {
        type: "message.created",
        occurredAt: "2026-09-07T17:00:00Z",
        data: {
          id: "message-1",
          text: "ping",
          createdAt: "2026-09-07T17:00:00Z",
          containerType: "channel",
          containerId: "channel-1",
          sender: { id: "human-1", displayName: "Jon", isBot: false }
        }
      }
    });
    assert.equal(handled, true);
    assert.equal(dispatched, true);
    assert.equal(sentBody.text, "pong");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
