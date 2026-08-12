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

## Verification

Before deployment of structural changes, run:

```bash
pnpm exec tsc --noEmit
SKIP_ENV_VALIDATION=1 pnpm lint
SKIP_ENV_VALIDATION=1 pnpm build
```

Production deployment is triggered by pushing `main`; verify the Vercel commit
status and a `200` response from the production URL.

## Known Gaps

- Eight Sleep endpoints are unofficial and can change without notice.
- Runtime table creation can add cold-start latency and should eventually move
  to deployment migrations.
- There are no automated integration tests against a real Pod or disposable
  PostgreSQL instance in this repository.
