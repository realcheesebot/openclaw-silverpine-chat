import { events, realtimeTicket } from "./api.js";
import { readCursor, writeCursor } from "./config.js";
import { dispatchMessage } from "./inbound.js";

const delay = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
});

// Node's WHATWG WebSocket implementation only permits 1000 or application
// close codes in the 3000-4999 range. 1011 is valid on the wire, but calling
// WebSocket.close(1011) throws synchronously in undici and can crash OpenClaw.
export const INBOUND_DISPATCH_CLOSE_CODE = 4000;

async function bootstrapCursor(account) {
  let cursor = readCursor(account.accountId);
  if (cursor) return cursor;
  for (;;) {
    const page = await events(account, cursor, 500);
    if (!page.items?.length || !page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }
  if (cursor) writeCursor(account.accountId, cursor);
  return cursor;
}

export function openSocket(url, signal, onEvent, WebSocketImpl = WebSocket) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocketImpl(url);
    let chain = Promise.resolve();
    let settled = false;
    const abort = () => socket.close(1000, "OpenClaw stopping");
    const finish = (error) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    signal.addEventListener("abort", abort, { once: true });
    socket.addEventListener("message", ({ data }) => {
      chain = chain.then(() => onEvent(JSON.parse(String(data))));
      chain.catch((error) => {
        try { socket.close(INBOUND_DISPATCH_CLOSE_CODE, "Inbound dispatch failed"); } catch {}
        finish(error);
      });
    });
    socket.addEventListener("close", () => chain.then(() => finish(), finish), { once: true });
    socket.addEventListener("error", () => finish(new Error("Silverpine Chat WebSocket failed")), { once: true });
  });
}

export async function startGateway(ctx, dependencies = {}) {
  const { account } = ctx;
  if (!account.configured) throw new Error(`Silverpine Chat account ${account.accountId} is not configured`);
  const channelRuntime = ctx.channelRuntime;
  if (!channelRuntime) throw new Error("OpenClaw channel runtime is unavailable");
  const bootstrap = dependencies.bootstrapCursor || bootstrapCursor;
  const getRealtimeTicket = dependencies.realtimeTicket || realtimeTicket;
  const connectSocket = dependencies.openSocket || openSocket;
  const wait = dependencies.delay || delay;
  let cursor;
  let bootstrapped = false;
  let attempts = 0;
  ctx.setStatus({ accountId: account.accountId, running: true, configured: true, connected: false });
  while (!ctx.abortSignal.aborted) {
    try {
      // Bootstrap is network-backed and must live inside the reconnect loop.
      // Otherwise a server outage during account startup terminates the channel
      // worker permanently instead of letting it recover when Chat returns.
      if (!bootstrapped) {
        cursor = await bootstrap(account);
        bootstrapped = true;
      }
      const { ticket } = await getRealtimeTicket(account);
      const wsUrl = new URL("/v1/realtime", account.serverUrl);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      wsUrl.searchParams.set("ticket", ticket);
      if (cursor) wsUrl.searchParams.set("after", cursor);
      ctx.setStatus({ accountId: account.accountId, running: true, connected: true, lastConnectedAt: Date.now() });
      attempts = 0;
      await connectSocket(wsUrl, ctx.abortSignal, async (event) => {
        await dispatchMessage({ event, account, cfg: ctx.cfg, channelRuntime });
        if (event.cursor) { cursor = event.cursor; writeCursor(account.accountId, cursor); }
      });
    } catch (error) {
      if (ctx.abortSignal.aborted || error?.name === "AbortError") break;
      attempts += 1;
      ctx.setStatus({ accountId: account.accountId, connected: false, reconnectAttempts: attempts, lastError: String(error?.message || error) });
      await wait(Math.min(30_000, 1_000 * 2 ** Math.min(attempts - 1, 5)), ctx.abortSignal).catch(() => {});
    }
  }
  ctx.setStatus({ accountId: account.accountId, running: false, connected: false });
}
