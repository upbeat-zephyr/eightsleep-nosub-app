import { db, queryClient } from "~/server/db";
import { users } from "~/server/db/schema";
import { eq } from "drizzle-orm";
import type postgres from "postgres";
import { obtainFreshAccessToken } from "~/server/eight/auth";
import { setHeatingLevel, turnOffSide, turnOnSide } from "~/server/eight/eight";
import type { Token } from "~/server/eight/types";
import {
  ensureNapSessionsTable,
  getNapSessions,
  type NapSession,
} from "~/server/napSessions";

const API_RETRY_ATTEMPTS = 1;
type TransactionSql = postgres.TransactionSql;

async function retryApiCall<T>(apiCall: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < API_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await apiCall();
    } catch (error) {
      lastError = error;
      if (attempt < API_RETRY_ATTEMPTS - 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, 500 * Math.pow(2, attempt)),
        );
      }
    }
  }
  throw lastError;
}

async function getFreshToken(targetEmail: string): Promise<Token> {
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

async function withTargetLock<T>(
  targetEmail: string,
  operation: (sql: TransactionSql) => Promise<T>,
): Promise<T> {
  await ensureNapSessionsTable();
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
  return withTargetLock(input.targetEmail, async (sql) => {
    const now = new Date();
    const session: NapSession = {
      id: crypto.randomUUID(),
      startedBy: input.startedBy,
      targetEmail: input.targetEmail,
      temperature: input.temperature * 10,
      startedAt: now,
      endsAt: new Date(now.getTime() + input.durationMinutes * 60 * 1000),
    };

    await retryApiCall(() => turnOnSide(token, token.eightUserId));
    try {
      try {
        await setHeatingLevel(
          token,
          token.eightUserId,
          session.temperature,
          input.durationMinutes * 60,
        );
      } catch (timedError) {
        console.warn(
          `Timed temperature control failed for ${input.targetEmail}; using scheduler cutoff instead:`,
          timedError,
        );
        await setHeatingLevel(token, token.eightUserId, session.temperature);
      }
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
    } catch (error) {
      await retryApiCall(() => turnOffSide(token, token.eightUserId)).catch(
        () => undefined,
      );
      throw error;
    }

    return session;
  });
}

export async function stopNapForTarget(
  targetEmail: string,
  sessionId?: string,
): Promise<boolean> {
  const token = await getFreshToken(targetEmail);
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
    }

    await retryApiCall(() => turnOffSide(token, token.eightUserId));
    if (sessionId) {
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
