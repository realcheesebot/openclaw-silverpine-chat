import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CHANNEL_ID = "silverpine-chat";
export const DEFAULT_ACCOUNT_ID = "default";
export const DEFAULT_SERVER_URL = "https://chat.spsw.io";

export function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value?.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export function channelConfig(cfg) {
  return cfg?.channels?.[CHANNEL_ID] ?? {};
}

export function credentialPath(accountId = DEFAULT_ACCOUNT_ID) {
  return path.join(os.homedir(), ".openclaw", "credentials", CHANNEL_ID, `${accountId}.json`);
}

export function cursorPath(accountId = DEFAULT_ACCOUNT_ID) {
  return path.join(os.homedir(), ".openclaw", "state", CHANNEL_ID, `${accountId}.cursor`);
}

export function readCredential(file) {
  const resolved = expandHome(file);
  if (!resolved) throw new Error("Silverpine Chat credential file is not configured");
  const value = JSON.parse(fs.readFileSync(resolved, "utf8"));
  if (typeof value.token !== "string" || !value.token.startsWith("spchat_bot_")) {
    throw new Error("Silverpine Chat credential file does not contain a valid bot token");
  }
  return value;
}

export function resolveAccount(cfg, accountId = DEFAULT_ACCOUNT_ID) {
  const config = channelConfig(cfg);
  const file = config.credentialFile || credentialPath(accountId);
  let credential = null;
  try { credential = readCredential(file); } catch {}
  return {
    accountId,
    enabled: config.enabled !== false,
    configured: Boolean(config.serverUrl && credential?.token),
    serverUrl: String(config.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, ""),
    credentialFile: file,
    credential,
    defaultTo: config.defaultTo,
    respondToBots: config.respondToBots === true
  };
}

export function readCursor(accountId) {
  try { return fs.readFileSync(cursorPath(accountId), "utf8").trim() || null; } catch { return null; }
}

export function writeCursor(accountId, cursor) {
  const file = cursorPath(accountId);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${cursor}\n`, { mode: 0o600 });
  fs.renameSync(temp, file);
}
