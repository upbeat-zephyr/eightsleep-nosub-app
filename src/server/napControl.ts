import { db, queryClient } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { ensureAwayPeriodsTable } from "~/server/awayPeriods";
import { obtainFreshAccessToken } from "~/server/eight/auth";
import { setHeatingLevel, turnOffSide, turnOnSide } from "~/server/eight/eight";
import type { Token } from "~/server/eight/types";
import {
  ensureNapSessionsTable,
  getNapSessions,
  type NapSession,
} from "~/server/napSessions";

const API_RETRY_ATTEMPTS = 2;
type TransactionSql = postgres.TransactionSql;

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  );
}

async function retryApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      if (isTimeoutError(error) || attempt >= API_RETRY_ATTEMPTS - 1) {
        break;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 250 * Math.pow(2, attempt)),
      );
    }
  }
  throw lastError;
}

async function assertNotAway(
  sql: TransactionSql,
  targetEmail: string,
  message: string,
): Promise<void> {
  const activeAway = await sql`
    SELECT 1 FROM "8slp_away_periods"
    WHERE target_email = ${targetEmail} AND starts_at <= now() AND ends_at > now()
    LIMIT 1
  `;
  if (activeAway.length > 0) {
    throw new Error(message);
  }
}

export async function getFreshToken(targetEmail: string): Promise<Token> {
  const user = await db.query.users.findFirst({
    where: eq(users.email, targetEmail),
  });
  if (!user) {
    throw new Error("Household account is not connected.");
  }

  const token: Token = {
    eightAccessToken: user.eightAccessToken,
    eightRefreshToken: user.eightRefreshToken,
    eightExpiresAtPosix: user.eightTokenExpiresAt.getTime(),
    eightUserId: user.eightUserId,
  };
  if (Date.now() <= token.eightExpiresAtPosix) {
    return token;
  }

  const refreshed = await obtainFreshAccessToken(
    token.eightRefreshToken,
    token.eightUserId,
  );
  await db
    .update(users)
    .set({
      eightAccessToken: refreshed.eightAccessToken,
      eightRefreshToken: refreshed.eightRefreshToken,
      eightTokenExpiresAt: new Date(refreshed.eightExpiresAtPosix),
      updatedAt: new Date(),
    })
    .where(eq(users.email, targetEmail));
  return refreshed;
}

export async function setDirectPower(
  targetEmail: string,
  state: "on" | "off",
): Promise<void> {
  const token = await getFreshToken(targetEmail);
  if (state === "on") {
    await withTargetLock(targetEmail, async (sql) => {
      await assertNotAway(sql, targetEmail, "End Away mode before turning the Pod on.");
    });
    await retryApiCall(() => turnOnSide(token, token.eightUserId));
    return;
  }
  await retryApiCall(() => turnOffSide(token, token.eightUserId));
}

export async function setDirectTemperature(
  targetEmail: string,
  temperature: number,
  durationMinutes?: number,
): Promise<void> {
  const token = await getFreshToken(targetEmail);
  await withTargetLock(targetEmail, async (sql) => {
    await assertNotAway(
      sql,
      targetEmail,
      "End Away mode before changing temperature.",
    );
  });
  await retryApiCall(() =>
    setHeatingLevel(
      token,
      token.eightUserId,
      temperature * 10,
      (durationMinutes ?? 0) * 60,
    ),
  );
}

export async function withTargetLock<T>(
  targetEmail: string,
  operation: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  await ensureNapSessionsTable();
  await ensureAwayPeriodsTable();
  return (await queryClient.begin(async (sql) => {
    await sql`SELECT pg_advisory_xact_lock(hashtext(${targetEmail}))`;
    return operation(sql);
  })) as T;
}

export async function startNapForTarget(input: {
  startedBy: string;
  targetEmail: string;
  temperature: number;
  durationMinutes: number;
}): Promise<NapSession> {
  const token = await getFreshToken(input.targetEmail);
  await withTargetLock(input.targetEmail, async (sql) => {
    await assertNotAway(
      sql,
      input.targetEmail,
      "End Away mode before starting a nap.",
    );
  });

  const now = new Date();
  const session: NapSession = {
    id: crypto.randomUUID(),
    startedBy: input.startedBy,
    targetEmail: input.targetEmail,
    temperature: input.temperature * 10,
    startedAt: now,
    endsAt: new Date(now.getTime() + input.durationMinutes * 60 * 1000),
  };

  try {
    await retryApiCall(() =>
      setHeatingLevel(
        token,
        token.eightUserId,
        session.temperature,
        input.durationMinutes * 60,
      ),
    );
  } catch (timedError) {
    if (isTimeoutError(timedError)) {
      throw timedError;
    }
    console.warn(
      `Timed temperature control failed for ${input.targetEmail}; using scheduler cutoff instead:`,
      timedError,
    );
    await retryApiCall(() =>
      setHeatingLevel(token, token.eightUserId, session.temperature),
    );
  }

  try {
    return await withTargetLock(input.targetEmail, async (sql) => {
      await assertNotAway(
        sql,
        input.targetEmail,
        "End Away mode before starting a nap.",
      );
      await sql`
        INSERT INTO "8slp_nap_sessions" (
          id, started_by, target_email, temperature, started_at, ends_at
        ) VALUES (
          ${session.id}, ${session.startedBy}, ${session.targetEmail},
          ${session.temperature},
          ${session.startedAt.toISOString()}::timestamptz,
          ${session.endsAt.toISOString()}::timestamptz
        )
        ON CONFLICT (target_email) DO UPDATE SET
          id = EXCLUDED.id,
          started_by = EXCLUDED.started_by,
          temperature = EXCLUDED.temperature,
          started_at = EXCLUDED.started_at,
          ends_at = EXCLUDED.ends_at
      `;
      return session;
    });
  } catch (error) {
    await retryApiCall(() => turnOffSide(token, token.eightUserId)).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function startAwayForTarget(input: {
  startedBy: string;
  targetEmail: string;
  startsAt: Date;
  endsAt: Date;
}): Promise<void> {
  const token = await getFreshToken(input.targetEmail);
  const activateNow = input.startsAt <= new Date();
  await withTargetLock(input.targetEmail, async (sql) => {
    if (activateNow) {
      await sql`
        DELETE FROM "8slp_nap_sessions"
        WHERE target_email = ${input.targetEmail}
      `;
    }
    await sql`
      INSERT INTO "8slp_away_periods" (
        target_email, started_by, starts_at, ends_at, activated_at, updated_at
      ) VALUES (
        ${input.targetEmail},
        ${input.startedBy},
        ${input.startsAt.toISOString()}::timestamptz,
        ${input.endsAt.toISOString()}::timestamptz,
        ${activateNow ? new Date().toISOString() : null}::timestamptz,
        now()
      )
      ON CONFLICT (target_email) DO UPDATE SET
        started_by = EXCLUDED.started_by,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        activated_at = EXCLUDED.activated_at,
        updated_at = now()
    `;
  });
  if (activateNow) {
    await retryApiCall(() => turnOffSide(token, token.eightUserId));
  }
}

export async function activateScheduledAwayForTarget(
  targetEmail: string,
  now = new Date(),
): Promise<boolean> {
  const token = await getFreshToken(targetEmail);
  const activated = await withTargetLock(targetEmail, async (sql) => {
    const due = await sql`
      SELECT 1 FROM "8slp_away_periods"
      WHERE target_email = ${targetEmail}
        AND starts_at <= ${now.toISOString()}::timestamptz
        AND ends_at > ${now.toISOString()}::timestamptz
        AND activated_at IS NULL
      LIMIT 1
    `;
    if (due.length === 0) return false;

    await sql`
      DELETE FROM "8slp_nap_sessions"
      WHERE target_email = ${targetEmail}
    `;
    await sql`
      UPDATE "8slp_away_periods"
      SET activated_at = ${now.toISOString()}::timestamptz, updated_at = now()
      WHERE target_email = ${targetEmail}
    `;
    return true;
  });
  if (!activated) return false;
  await retryApiCall(() => turnOffSide(token, token.eightUserId));
  return true;
}

export async function clearAwayForTarget(targetEmail: string): Promise<void> {
  await withTargetLock(targetEmail, async (sql) => {
    await sql`
      DELETE FROM "8slp_away_periods"
      WHERE target_email = ${targetEmail}
    `;
  });
}

export async function stopNapForTarget(
  targetEmail: string,
  sessionId?: string,
): Promise<boolean> {
  const token = await getFreshToken(targetEmail);
  const shouldStop = await withTargetLock(targetEmail, async (sql) => {
    if (!sessionId) return true;
    const current = await sql`
      SELECT id FROM "8slp_nap_sessions"
      WHERE target_email = ${targetEmail}
      LIMIT 1
    `;
    return current[0]?.id === sessionId;
  });
  if (!shouldStop) return false;

  await retryApiCall(() => turnOffSide(token, token.eightUserId));
  return withTargetLock(targetEmail, async (sql) => {
    if (sessionId) {
      const current = await sql`
        SELECT id FROM "8slp_nap_sessions"
        WHERE target_email = ${targetEmail}
        LIMIT 1
      `;
      if (current[0]?.id !== sessionId) {
        return false;
      }
      await sql`
        DELETE FROM "8slp_nap_sessions"
        WHERE target_email = ${targetEmail} AND id = ${sessionId}
      `;
    } else {
      await sql`
        DELETE FROM "8slp_nap_sessions"
        WHERE target_email = ${targetEmail}
      `;
    }
    return true;
  });
}

export async function processExpiredNaps(now = new Date()): Promise<{
  offCount: number;
  activeTargetEmails: Set<string>;
  processedTargetEmails: Set<string>;
}> {
  const sessions = await getNapSessions();
  const due = sessions.filter((session) => session.endsAt <= now);
  let offCount = 0;
  const processedTargetEmails = new Set<string>();

  for (const session of due) {
    try {
      const stopped = await stopNapForTarget(session.targetEmail, session.id);
      if (!stopped) continue;
      processedTargetEmails.add(session.targetEmail);
      offCount += 1;
    } catch (error) {
      console.error(`Failed to end nap for ${session.targetEmail}:`, error);
    }
  }

  const activeTargetEmails = new Set(
    (await getNapSessions())
      .filter((session) => session.endsAt > now)
      .map((session) => session.targetEmail),
  );
  return { offCount, activeTargetEmails, processedTargetEmails };
}
