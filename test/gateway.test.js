import test from "node:test";
import assert from "node:assert/strict";
import { INBOUND_DISPATCH_CLOSE_CODE, openSocket } from "../src/gateway.js";

class FakeWebSocket {
  static instance;
  listeners = new Map();
  closeCode = null;
  constructor() { FakeWebSocket.instance = this; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  close(code) {
    if (code !== 1000 && (code < 3000 || code > 4999)) throw new DOMException("invalid code", "InvalidAccessError");
    this.closeCode = code;
    queueMicrotask(() => this.listeners.get("close")?.({ code }));
  }
  emit(type, payload) { this.listeners.get(type)?.(payload); }
}

test("dispatch failure closes safely and preserves the original rejection", async () => {
  const controller = new AbortController();
  const original = new Error("dispatch failed");
  const connected = openSocket("wss://chat.example", controller.signal, async () => { throw original; }, FakeWebSocket);
  FakeWebSocket.instance.emit("message", { data: JSON.stringify({ type: "message.created" }) });
  await assert.rejects(connected, (error) => error === original);
  assert.equal(FakeWebSocket.instance.closeCode, INBOUND_DISPATCH_CLOSE_CODE);
});
