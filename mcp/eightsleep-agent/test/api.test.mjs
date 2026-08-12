import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

const serverFile = new URL("../server.mjs", import.meta.url);

test("write tool sends bearer token and stable caller idempotency key", async () => {
  let captured;
  const api = http.createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      captured = {
        authorization: request.headers.authorization,
        idempotencyKey: request.headers["idempotency-key"],
        body: JSON.parse(body),
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true }));
    });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address === "object");

  const child = spawn(process.execPath, [serverFile.pathname, "serve"], {
    env: {
      ...process.env,
      EIGHTSLEEP_AGENT_API_URL: `http://127.0.0.1:${address.port}/api/agent/v1`,
      EIGHTSLEEP_AGENT_API_TOKEN: "secret-test-token",
    },
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
  );
  child.stdin.write(
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "eight_sleep_set_power", arguments: { targetEmail: "me@example.com", state: "off", idempotencyKey: "calendar-trip-123" } } })}\n`,
  );
  child.stdin.end();
  await once(child, "exit");
  api.close();

  assert.equal(captured.authorization, "Bearer secret-test-token");
  assert.equal(captured.idempotencyKey, "calendar-trip-123");
  assert.deepEqual(captured.body, {
    operation: "power.set",
    targetEmail: "me@example.com",
    state: "off",
  });
  assert.doesNotMatch(output, /secret-test-token/);
});
