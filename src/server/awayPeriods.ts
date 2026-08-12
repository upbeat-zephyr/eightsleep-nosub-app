import { queryClient } from "~/server/db";

export type AwayPeriod = {
  targetEmail: string;
  startedBy: string;
  startsAt: Date;
  endsAt: Date;
};

let ensureTablePromise: Promise<void> | null = null;

async function retryDb<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < 2) {
        await new Promise((resolve) =>
          setTimeout(resolve, 300 * Math.pow(2, attempt)),
        );
      }
    }
  }
  throw lastError;
}

export async function ensureAwayPeriodsTable(): Promise<void> {
  ensureTablePromise ??= retryDb(async () => {
    await queryClient`
      CREATE TABLE IF NOT EXISTS "8slp_away_periods" (
        target_email varchar(255) PRIMARY KEY REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        started_by varchar(255) NOT NULL REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        starts_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL
      )
    `;
  }).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });
  return ensureTablePromise;
}

export async function clearAwayPeriod(targetEmail: string): Promise<void> {
  await ensureAwayPeriodsTable();
  await queryClient`
    DELETE FROM "8slp_away_periods"
    WHERE target_email = ${targetEmail}
  `;
}

export async function getActiveAwayPeriods(
  now = new Date(),
): Promise<AwayPeriod[]> {
  await ensureAwayPeriodsTable();
  await queryClient`
    DELETE FROM "8slp_away_periods"
    WHERE ends_at <= ${now.toISOString()}::timestamptz
  `;
  const rows = await queryClient`
    SELECT target_email, started_by, starts_at, ends_at
    FROM "8slp_away_periods"
    WHERE starts_at <= ${now.toISOString()}::timestamptz
      AND ends_at > ${now.toISOString()}::timestamptz
    ORDER BY ends_at ASC
  `;
  return rows.map((row) => ({
    targetEmail: String(row.target_email),
    startedBy: String(row.started_by),
    startsAt: new Date(String(row.starts_at)),
    endsAt: new Date(String(row.ends_at)),
  }));
}
