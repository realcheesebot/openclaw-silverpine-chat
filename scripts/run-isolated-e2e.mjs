import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const project = path.resolve(import.meta.dirname, "..");
const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "silverpine-chat-e2e-"));
const workspace = path.join(stateDir, "workspace");
const credentialFile = path.join(stateDir, "credential.json");
const configFile = path.join(stateDir, "openclaw.json");
const outputFile = path.join(stateDir, "reply.json");
const isolatedAgentDir = path.join(stateDir, "agents", "main", "agent");
const liveAgentDb = "/home/ubuntu/.openclaw/agents/main/agent/openclaw-agent.sqlite";
const mockPort = 18151;
const gatewayPort = 18891;
const children = [];

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function httpReady(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

let failure = null;
try {
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(isolatedAgentDir, { recursive: true, mode: 0o700 });
  // Copy the current authenticated agent store into the disposable state. The
  // copy is never committed and the entire directory is removed on success.
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      await fs.copyFile(`${liveAgentDb}${suffix}`, path.join(isolatedAgentDir, `openclaw-agent.sqlite${suffix}`));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  await fs.writeFile(path.join(workspace, "AGENTS.md"), "Reply exactly as requested.\n", { mode: 0o600 });
  await fs.writeFile(credentialFile, JSON.stringify({
    tokenType: "Bot",
    token: "spchat_bot_isolated_test_token",
    botId: "bot_isolated_test",
    credentialId: "cred_isolated_test",
    groupId: "grp_isolated_test",
    permissions: ["messages:read", "messages:write", "events:read"],
  }), { mode: 0o600 });
  await fs.writeFile(configFile, JSON.stringify({
    gateway: { port: gatewayPort, mode: "local", bind: "loopback", auth: { mode: "none" } },
    agents: {
      defaults: {
        workspace,
        model: { primary: "openai/gpt-5.6-sol", fallbacks: ["openai/gpt-5.4"] },
        models: {
          "openai/gpt-5.6-sol": { agentRuntime: { id: "codex" } },
          "openai/gpt-5.4": { agentRuntime: { id: "codex" } },
        },
      },
      list: [{ id: "main", default: true }],
    },
    plugins: {
      entries: {
        codex: { enabled: true, config: { discovery: { enabled: true, timeoutMs: 2500 } } },
        "silverpine-chat": { enabled: true },
      },
      load: { paths: [project] },
    },
    channels: {
      "silverpine-chat": {
        enabled: true,
        serverUrl: `http://127.0.0.1:${mockPort}`,
        credentialFile,
      },
    },
  }, null, 2), { mode: 0o600 });

  const mock = start(process.execPath, [path.join(project, "scripts/mock-chat-server.mjs")], {
    MOCK_CHAT_PORT: String(mockPort),
    MOCK_CHAT_OUTPUT: outputFile,
  });
  await waitFor(() => httpReady(`http://127.0.0.1:${mockPort}/v1/bot/events`), 10_000, "mock Chat server");

  const gateway = start("openclaw", ["gateway", "run", "--port", String(gatewayPort)], {
    HOME: stateDir,
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configFile,
  });
  // A completely clean state may need to materialize the configured Codex
  // runtime package before the gateway can listen.
  await waitFor(() => httpReady(`http://127.0.0.1:${gatewayPort}/health`), 120_000, "isolated gateway liveness");
  await waitFor(async () => {
    try {
      const body = JSON.parse(await fs.readFile(outputFile, "utf8"));
      return body.text === "ISOLATED_PLUGIN_OK";
    } catch {
      return false;
    }
  }, 180_000, "real agent reply through the plugin");

  const reply = JSON.parse(await fs.readFile(outputFile, "utf8"));
  process.stdout.write(`isolated-e2e-pass:${reply.text}\n`);
  if (gateway.exitCode !== null || mock.exitCode !== null) throw new Error("A test process exited unexpectedly");
} catch (error) {
  failure = error;
  process.stderr.write(`isolated-e2e-fail:${error?.stack || error}\n`);
  process.exitCode = 1;
} finally {
  const exits = [];
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      exits.push(new Promise((resolve) => child.once("exit", resolve)));
      child.kill("SIGTERM");
    }
  }
  await Promise.race([
    Promise.all(exits),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (failure) process.stderr.write(`isolated-e2e-state:${stateDir}\n`);
  else await fs.rm(stateDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}
