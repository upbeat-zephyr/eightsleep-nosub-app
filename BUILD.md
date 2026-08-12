# System Build Record

## Scope

This Next.js app controls approved Eight Sleep accounts through unofficial cloud
APIs. It provides recurring automation, one-time overrides, timed naps, and
app-level Away periods for the account owner and connected household member.

The app does not implement Eight Sleep Autopilot, a local Pod protocol, guest
profiles, or alarm creation.

## Structure

- `src/server/api/routers/user.ts`: login, recurring settings, and one-time
  overrides.
- `src/server/api/routers/nap.ts`: household discovery and timed nap controls.
- `src/server/api/routers/away.ts`: household-aware Away activation and clearing.
- `src/server/onoff.ts`: scheduled recurring actions and precedence decisions.
- `src/server/napSessions.ts`: durable active nap deadlines.
- `src/server/awayPeriods.ts`: durable per-account Away deadlines.
- `src/server/household.ts`: self/partner authorization. The configured household
  manager, or otherwise the first `APPROVED_EMAILS` entry, can manage connected
  household accounts. Other users can manage only themselves.
- `src/server/agentAccess.ts`: hashed personal agent tokens, exact target/scope
  grants, idempotency records, rate enforcement, revocation, and audit events.
- `src/app/api/agent/v1/route.ts`: versioned bearer-authenticated command API.
- `mcp/eightsleep-agent/server.mjs`: canonical dependency-free stdio MCP adapter
  that calls the command API. Harness configuration only points to this file.

## Automation Precedence

The scheduler applies this order per target account:

1. Process expired nap deadlines and turn those sides off.
2. Skip recurring, one-time, temperature-step, and forced actions for an active
   nap or a nap ended in the current scheduler run.
3. Skip all scheduler actions for an active Away period.
4. Otherwise evaluate one-time overrides, recurring on/off times, and overnight
   temperature steps.

Starting Away today acquires a per-account database advisory lock, turns the
selected side off, removes any active nap, and persists Away before releasing
the lock. A future Away range is persisted as pending; the scheduler acquires
the same lock, turns the side off once on or after its start date, removes an
active nap, and marks the range activated. Nap start and scheduler provider
actions re-check Away under that lock before turning a side on. Away does not
mutate recurring settings. Expired Away rows are deleted when Away state or the
scheduler is read, after which normal automation is eligible again.

## Persistence

The app creates these small support tables on first use:

- `8slp_nap_sessions`: one active nap per target account.
- `8slp_away_periods`: one active Away period per target account.
- `8slp_automation_overrides`: one-time on/off overrides.
- `8slp_agent_tokens` and `8slp_agent_grants`: revocable agent identities and
  exact per-target capabilities. Only SHA-256 token hashes are stored.
- `8slp_agent_requests`: idempotency reservation and sanitized replay responses.
- `8slp_agent_audit`: sanitized management and command outcomes.
- `8slp_agent_rate_limits`: atomic fixed-minute request counters per token.

Runtime database credentials therefore require schema creation permission. No
credential values belong in this record.

## Operation

- Away can target self, partner, or both with an `Away from` and `Return home`
  date. The start is local midnight and the return is local noon, both converted
  by the browser to UTC before persistence.
- Future Away ranges can be scheduled in advance. Activation accuracy depends
  on scheduler cadence.
- The synthetic `testTime` cron parameter is disabled in production because Away
  cleanup and activation are state-changing operations.
- Clearing Away immediately makes the account eligible for the next scheduler
  run; it does not immediately turn the Pod on.
- Expiration accuracy depends on calls to `/api/temperatureCron`. The bundled
  local service checks every minute; external scheduler cadence may differ.
- The app uses the Eight Sleep timed temperature request plus durable nap
  deadlines. Away is implemented entirely at the app scheduler layer because
  the repository's private provider Away endpoint has unverified semantics.

### Agent Access

1. Open the app's **Agent** destination.
2. Name the assistant, select allowed household sides, and create a key.
3. Copy the `8slp_pat_v1...` key; plaintext is shown once and never stored.
4. Set `EIGHTSLEEP_AGENT_API_URL` to the deployed `/api/agent/v1` endpoint and
   `EIGHTSLEEP_AGENT_API_TOKEN` to that key in the agent runtime environment.
5. Run `node mcp/eightsleep-agent/server.mjs doctor`, then configure the chosen
   MCP client using `mcp/eightsleep-agent/README.md`.

Agent keys receive the full command scope only for explicitly selected targets,
expire after 180 days, and can be revoked without affecting browser sessions or
Eight Sleep credentials. Every write requires an `Idempotency-Key`; MCP creates
one automatically and accepts a stable caller key for calendar-trigger retries.
Requests still in progress after two minutes become `indeterminate` and are not
automatically executed again. The agent API is not an arbitrary HTTP/provider
proxy.

Agent command operations are `state.get`, `schedule.update`, `once.set`,
`once.clear`, `nap.start`, `nap.stop`, `away.schedule`, `away.clear`,
`power.set`, and `temperature.set`. Direct on/temperature actions reject active
Away rather than silently overriding it.

The API applies an atomic 30-request-per-minute token limit. Unexpected provider
errors use stable codes without upstream payloads or credentials. Audit records
exclude bearer tokens, cookies, provider credentials, and idempotency keys.

## Verification

Before deployment of structural changes, run:

```bash
pnpm exec tsc --noEmit
SKIP_ENV_VALIDATION=1 pnpm lint
SKIP_ENV_VALIDATION=1 pnpm build
pnpm test:mcp
```

Production deployment is triggered by pushing `main`; verify the Vercel commit
status and a `200` response from the production URL.

## Known Gaps

- Eight Sleep endpoints are unofficial and can change without notice.
- Runtime table creation can add cold-start latency and should eventually move
  to deployment migrations.
- There are no automated integration tests against a real Pod or disposable
  PostgreSQL instance in this repository.
