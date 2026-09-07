import fs from "node:fs";
import http from "node:http";
import { WebSocketServer } from "ws";

const port = Number(process.env.MOCK_CHAT_PORT || 18151);
const output = process.env.MOCK_CHAT_OUTPUT;
const event = {
  cursor: "MQ",
  type: "message.created",
  occurredAt: new Date().toISOString(),
  data: {
    id: "msg_isolated_gateway_test",
    text: "Reply with exactly: ISOLATED_PLUGIN_OK",
    createdAt: new Date().toISOString(),
    containerType: "channel",
    containerId: "chn_isolated_gateway_test",
    sender: { id: "usr_isolated_test", displayName: "Integration Test", isBot: false }
  }
};

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url?.startsWith("/v1/bot/events")) {
    return json(res, 200, { items: [], nextCursor: "MA" });
  }
  if (req.method === "POST" && req.url === "/v1/bot/realtime/tickets") {
    return json(res, 201, { ticket: "isolated-test-ticket" });
  }
  if (req.method === "POST" && req.url === "/v1/bot/channels/chn_isolated_gateway_test/messages") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const body = JSON.parse(raw);
      if (output) fs.writeFileSync(output, JSON.stringify(body));
      json(res, 201, { id: "msg_isolated_reply" });
    });
    return;
  }
  json(res, 404, { error: "not_found" });
});

const sockets = new WebSocketServer({ noServer: true });
server.on("upgrade", (request, socket, head) => {
  if (!request.url?.startsWith("/v1/realtime")) return socket.destroy();
  sockets.handleUpgrade(request, socket, head, (ws) => {
    ws.send(JSON.stringify(event));
  });
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`mock-chat-ready:${port}\n`);
});
