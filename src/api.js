import { randomUUID } from "node:crypto";

async function request(account, method, route, body) {
  const response = await fetch(`${account.serverUrl}${route}`, {
    method,
    headers: {
      Authorization: `Bot ${account.credential.token}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const code = payload?.error?.code || `http_${response.status}`;
    throw new Error(`Silverpine Chat ${method} ${route} failed: ${code}`);
  }
  return payload;
}

export async function pair(serverUrl, pairingCode, label = "OpenClaw") {
  const response = await fetch(`${serverUrl.replace(/\/$/, "")}/v1/bot/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ pairingCode, label })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `Pairing failed with HTTP ${response.status}`);
  return payload;
}

export const botMe = (account) => request(account, "GET", "/v1/bot/me");
export const events = (account, after, limit = 500) => request(account, "GET", `/v1/bot/events?limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`);
export const realtimeTicket = (account) => request(account, "POST", "/v1/bot/realtime/tickets");

export function parseTarget(target) {
  const raw = String(target || "").trim();
  if (raw.startsWith("conversation:")) return { kind: "conversation", id: raw.slice(13) };
  if (raw.startsWith("channel:")) return { kind: "channel", id: raw.slice(8) };
  return { kind: "channel", id: raw };
}

export async function sendText(account, target, text, clientMessageId = randomUUID()) {
  const parsed = parseTarget(target);
  if (!parsed.id) throw new Error("Silverpine Chat message target is required");
  const route = parsed.kind === "conversation"
    ? `/v1/bot/conversations/${encodeURIComponent(parsed.id)}/messages`
    : `/v1/bot/channels/${encodeURIComponent(parsed.id)}/messages`;
  return request(account, "POST", route, { clientMessageId, text });
}
