---
name: eightsleep-agent
description: Configure and use the scoped Eight Sleep agent API and portable local MCP tools for schedules, Once, Nap, Away, power, and temperature. Use when connecting an AI assistant to this app or operating its agent tools; not for browser-only manual controls.
---

# Eight Sleep Agent

Use the app's **Agent** page to create a revocable key for explicitly selected
household sides. Never request or expose the Eight Sleep password, browser
cookie, provider token, database credentials, or `CRON_SECRET`.

The canonical executable is `server.mjs`. It communicates with the scoped HTTPS
API using `EIGHTSLEEP_AGENT_API_URL` and `EIGHTSLEEP_AGENT_API_TOKEN` from the
runtime environment. Run `node server.mjs doctor` before configuring a harness.

Read `README.md` for Codex, Claude Code, OpenCode, and terminal setup. Writes are
idempotent; calendar-driven retries should supply and reuse a stable
`idempotencyKey` derived from the event occurrence.

Do not duplicate this workflow or executable in harness-specific directories.
Harness configuration should only point to this canonical server.
