import test from "node:test";
import assert from "node:assert/strict";
import { isDispatchableMessage } from "../src/inbound.js";
import { parseTarget } from "../src/api.js";

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
