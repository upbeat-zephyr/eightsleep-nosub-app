import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";

const server = new URL("../server.mjs", import.meta.url);

test("help and version work", async () => {
  const child = spawn(process.execPath, [server.pathname, "--version"]);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  await once(child, "exit");
  assert.match(output, /^1\.0\.0/);
});

test("stdio initializes and lists tools", async () => {
  const child = spawn(process.execPath, [server.pathname, "serve"], {
    env: {
      ...process.env,
      EIGHTSLEEP_AGENT_API_URL: "http://localhost:3000/api/agent/v1",
      EIGHTSLEEP_AGENT_API_TOKEN: "test",
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
    `${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })}\n`,
  );
  child.stdin.end();
  await once(child, "exit");
  const messages = output.trim().split("\n").map(JSON.parse);
  assert.equal(messages[0].result.protocolVersion, "2025-06-18");
  assert.equal(messages[1].result.tools.length, 10);
});
