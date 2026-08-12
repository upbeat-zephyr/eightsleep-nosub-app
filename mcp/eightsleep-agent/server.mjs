#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import readline from "node:readline";

const VERSION = "1.0.0";
const PROTOCOLS = new Set(["2025-06-18", "2025-03-26"]);
const TOOLS = [
  tool(
    "eight_sleep_get_state",
    "Read schedule, Once, Nap, and Away state",
    "state.get",
    [target()],
  ),
  tool(
    "eight_sleep_update_schedule",
    "Replace the recurring schedule",
    "schedule.update",
    [
      target(),
      str("onTime", "24-hour HH:MM"),
      str("offTime", "24-hour HH:MM"),
      str("timezone", "IANA timezone"),
      integer("initialTemperature", -10, 10),
      {
        name: "temperatureSteps",
        schema: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              time: { type: "string" },
              temperature: { type: "integer", minimum: -10, maximum: 10 },
            },
            required: ["time", "temperature"],
            additionalProperties: false,
          },
        },
      },
    ],
  ),
  tool(
    "eight_sleep_set_once",
    "Set a one-time on and/or off time",
    "once.set",
    [
      target(),
      optionalStr("onTime", "24-hour HH:MM"),
      optionalStr("offTime", "24-hour HH:MM"),
      str("timezone", "IANA timezone"),
      str("localDate", "YYYY-MM-DD"),
    ],
  ),
  tool("eight_sleep_clear_once", "Clear one-time times", "once.clear", [
    target(),
  ]),
  tool("eight_sleep_start_nap", "Start a timed nap", "nap.start", [
    target(),
    integer("temperature", -10, 10),
    integer("durationMinutes", 15, 480),
  ]),
  tool("eight_sleep_stop_nap", "Stop a nap and turn the side off", "nap.stop", [
    target(),
  ]),
  tool("eight_sleep_schedule_away", "Schedule an Away range", "away.schedule", [
    target(),
    str("startsAt", "ISO date-time"),
    str("endsAt", "ISO date-time"),
  ]),
  tool("eight_sleep_clear_away", "End or cancel Away", "away.clear", [
    target(),
  ]),
  tool("eight_sleep_set_power", "Turn one side on or off", "power.set", [
    target(),
    { name: "state", schema: { type: "string", enum: ["on", "off"] } },
  ]),
  tool(
    "eight_sleep_set_temperature",
    "Set temperature now",
    "temperature.set",
    [
      target(),
      integer("temperature", -10, 10),
      optionalInteger("durationMinutes", 15, 480),
    ],
  ),
];

function target() {
  return str("targetEmail", "Exact granted target email");
}
function str(name, description) {
  return { name, schema: { type: "string", description } };
}
function optionalStr(name, description) {
  return { ...str(name, description), optional: true };
}
function integer(name, minimum, maximum) {
  return { name, schema: { type: "integer", minimum, maximum } };
}
function optionalInteger(name, minimum, maximum) {
  return { ...integer(name, minimum, maximum), optional: true };
}
function tool(name, description, operation, fields) {
  if (operation !== "state.get") {
    fields = [
      ...fields,
      optionalStr(
        "idempotencyKey",
        "Optional stable 8-128 character key to reuse when retrying the same action",
      ),
    ];
  }
  const properties = Object.fromEntries(
    fields.map((field) => [field.name, field.schema]),
  );
  const required = fields
    .filter((field) => !field.optional)
    .map((field) => field.name);
  return {
    name,
    description,
    operation,
    inputSchema: {
      type: "object",
      properties,
      required,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: operation === "state.get",
      destructiveHint: operation.endsWith("clear") || operation === "power.set",
      idempotentHint: operation !== "nap.start",
      openWorldHint: true,
    },
  };
}

function config() {
  const apiUrl = process.env.EIGHTSLEEP_AGENT_API_URL;
  const token = process.env.EIGHTSLEEP_AGENT_API_TOKEN;
  const timeoutMs = Number(
    process.env.EIGHTSLEEP_AGENT_API_TIMEOUT_MS ?? 30_000,
  );
  if (!apiUrl || !token)
    throw new Error(
      "EIGHTSLEEP_AGENT_API_URL and EIGHTSLEEP_AGENT_API_TOKEN are required",
    );
  const parsed = new URL(apiUrl);
  if (
    parsed.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(parsed.hostname)
  ) {
    throw new Error("API URL must use HTTPS except for localhost");
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 120_000)
    throw new Error("Invalid API timeout");
  return { apiUrl: parsed.toString(), token, timeoutMs };
}

async function api(body, isRead = false, idempotencyKey) {
  const { apiUrl, token, timeoutMs } = config();
  const response = await fetch(apiUrl, {
    method: isRead ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(isRead ? {} : { "idempotency-key": idempotencyKey ?? randomUUID() }),
    },
    body: isRead ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await response
    .json()
    .catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data;
}

function result(value, isError = false) {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

async function callTool(name, args) {
  const selected = TOOLS.find((candidate) => candidate.name === name);
  if (!selected) throw rpcError(-32602, "Unknown tool");
  validate(selected.inputSchema, args);
  const { idempotencyKey, ...toolArgs } = args;
  const body = { operation: selected.operation, ...toolArgs };
  try {
    const response = await api(body, false, idempotencyKey);
    return result(response);
  } catch (error) {
    return result(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Tool failed",
      },
      true,
    );
  }
}

function validate(schema, value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw rpcError(-32602, "Arguments must be an object");
  for (const key of Object.keys(value))
    if (!(key in schema.properties))
      throw rpcError(-32602, `Unknown argument: ${key}`);
  for (const key of schema.required)
    if (!(key in value)) throw rpcError(-32602, `Missing argument: ${key}`);
  for (const [key, item] of Object.entries(value)) {
    const expected = schema.properties[key];
    if (expected.type === "string" && typeof item !== "string")
      throw rpcError(-32602, `${key} must be a string`);
    if (
      expected.type === "integer" &&
      (!Number.isInteger(item) ||
        item < expected.minimum ||
        item > expected.maximum)
    )
      throw rpcError(-32602, `${key} is out of range`);
    if (expected.enum && !expected.enum.includes(item))
      throw rpcError(-32602, `${key} is invalid`);
    if (expected.type === "array" && !Array.isArray(item))
      throw rpcError(-32602, `${key} must be an array`);
  }
}

function rpcError(code, message) {
  return Object.assign(new Error(message), { code });
}
function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function serve() {
  let initialized = false;
  const reader = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });
  for await (const line of reader) {
    let request;
    try {
      request = JSON.parse(line);
    } catch {
      send({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      });
      continue;
    }
    if (
      !request ||
      request.jsonrpc !== "2.0" ||
      Array.isArray(request) ||
      request.id === null
    ) {
      if (request?.id !== undefined)
        send({
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32600, message: "Invalid request" },
        });
      continue;
    }
    if (request.id === undefined) {
      if (request.method === "notifications/initialized") initialized = true;
      continue;
    }
    try {
      let response;
      if (request.method === "initialize") {
        const requested = request.params?.protocolVersion;
        const protocolVersion = PROTOCOLS.has(requested)
          ? requested
          : "2025-06-18";
        response = {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: { name: "eightsleep-agent", version: VERSION },
        };
      } else if (request.method === "ping") response = {};
      else if (!initialized) throw rpcError(-32600, "Server not initialized");
      else if (request.method === "tools/list")
        response = {
          tools: TOOLS.map(
            ({ operation: _operation, ...toolDefinition }) => toolDefinition,
          ),
        };
      else if (request.method === "tools/call")
        response = await callTool(
          request.params?.name,
          request.params?.arguments ?? {},
        );
      else throw rpcError(-32601, "Method not found");
      send({ jsonrpc: "2.0", id: request.id, result: response });
    } catch (error) {
      send({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: error.code ?? -32603,
          message: error.message ?? "Internal error",
        },
      });
    }
  }
}

async function doctor(offline, asJson) {
  try {
    const current = config();
    const details = {
      ok: true,
      node: process.version,
      apiOrigin: new URL(current.apiUrl).origin,
      configured: true,
      reachable: null,
    };
    if (!offline) {
      await api(null, true);
      details.reachable = true;
    }
    console.log(
      asJson
        ? JSON.stringify(details)
        : `Configuration OK${offline ? " (offline)" : "; API reachable"}`,
    );
  } catch (error) {
    const details = {
      ok: false,
      error: error instanceof Error ? error.message : "Doctor failed",
    };
    console.log(asJson ? JSON.stringify(details) : `Error: ${details.error}`);
    process.exitCode = 1;
  }
}

function help() {
  console.log(
    `Eight Sleep Agent MCP ${VERSION}\n\nUsage: node server.mjs [serve|doctor] [--offline] [--json]\n\nEnvironment:\n  EIGHTSLEEP_AGENT_API_URL\n  EIGHTSLEEP_AGENT_API_TOKEN\n  EIGHTSLEEP_AGENT_API_TIMEOUT_MS`,
  );
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) help();
else if (args.includes("--version")) console.log(VERSION);
else if ((args[0] ?? "serve") === "doctor")
  await doctor(args.includes("--offline"), args.includes("--json"));
else if ((args[0] ?? "serve") === "serve") await serve();
else {
  help();
  process.exitCode = 2;
}
