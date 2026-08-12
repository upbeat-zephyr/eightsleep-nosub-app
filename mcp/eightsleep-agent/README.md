# Eight Sleep Agent MCP

Portable stdio MCP adapter for the app's scoped agent API. The HTTPS API owns
authorization, target grants, idempotency, audit logging, and Eight Sleep
business rules. This adapter contains no credentials and never receives Eight
Sleep account credentials.

## Setup

Create a key in the app's **Agent** page, then set:

```bash
export EIGHTSLEEP_AGENT_API_URL="https://eightsleep-nosub-app2.vercel.app/api/agent/v1"
export EIGHTSLEEP_AGENT_API_TOKEN="8slp_pat_v1..."
node mcp/eightsleep-agent/server.mjs doctor
```

For calendar or booking automations, pass a stable `idempotencyKey` derived from
the event ID and occurrence. Reuse the same key if transport fails; do not create
a new action until the API reports a definitive result.

Run directly with `node mcp/eightsleep-agent/server.mjs serve`. Use `--help`
for the terminal contract.

## Harness Configuration

All harnesses invoke the same canonical executable. Keep secrets in environment
variables, never checked-in configuration.

### Codex

```toml
[mcp_servers.eightsleep]
command = "node"
args = ["/absolute/path/eightsleep-nosub-app/mcp/eightsleep-agent/server.mjs", "serve"]
env_vars = ["EIGHTSLEEP_AGENT_API_URL", "EIGHTSLEEP_AGENT_API_TOKEN"]
```

### Claude Code

```bash
claude mcp add --transport stdio --scope user eightsleep -- \
  node /absolute/path/eightsleep-nosub-app/mcp/eightsleep-agent/server.mjs serve
```

### OpenCode

```jsonc
{
  "mcp": {
    "eightsleep": {
      "type": "local",
      "command": [
        "node",
        "/absolute/path/eightsleep-nosub-app/mcp/eightsleep-agent/server.mjs",
        "serve",
      ],
      "environment": {
        "EIGHTSLEEP_AGENT_API_URL": "{env:EIGHTSLEEP_AGENT_API_URL}",
        "EIGHTSLEEP_AGENT_API_TOKEN": "{env:EIGHTSLEEP_AGENT_API_TOKEN}",
      },
    },
  },
}
```

## Compatibility

| Surface                      | Interface        | Verification                              |
| ---------------------------- | ---------------- | ----------------------------------------- |
| Codex CLI 0.147.0            | Native stdio MCP | Static configuration; protocol smoke test |
| Claude Code 1.0.88           | Native stdio MCP | Static configuration; protocol smoke test |
| OpenCode 1.18.16             | Native local MCP | Static configuration; protocol smoke test |
| Terminal / other MCP clients | Node 20+ stdio   | `node:test` lifecycle test                |

Live harness configuration is intentionally not installed automatically.
