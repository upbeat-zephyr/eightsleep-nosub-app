import { queryClient } from "~/server/db";

export type AwayPeriod = {
  targetEmail: string;
  startedBy: string;
  startsAt: Date;
  endsAt: Date;
  activatedAt: Date | null;
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
        activated_at timestamptz,
        updated_at timestamptz DEFAULT now() NOT NULL
      )
    `;
    await queryClient`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM information_schema.columns
          WHERE table_name = '8slp_away_periods'
            AND column_name = 'activated_at'
        ) THEN
          ALTER TABLE "8slp_away_periods"
          ADD COLUMN activated_at timestamptz;

          UPDATE "8slp_away_periods"
          SET activated_at = starts_at
          WHERE activated_at IS NULL;
        END IF;
      END $$
    `;
  }).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });
  return ensureTablePromise;
}

export async function getAwayPeriods(now = new Date()): Promise<AwayPeriod[]> {
  await ensureAwayPeriodsTable();
  await queryClient`
    DELETE FROM "8slp_away_periods"
    WHERE ends_at <= ${now.toISOString()}::timestamptz
  `;
  const rows = await queryClient`
    SELECT target_email, started_by, starts_at, ends_at, activated_at
    FROM "8slp_away_periods"
    WHERE ends_at > ${now.toISOString()}::timestamptz
    ORDER BY starts_at ASC
  `;
  return rows.map((row) => ({
    targetEmail: String(row.target_email),
    startedBy: String(row.started_by),
    startsAt: new Date(String(row.starts_at)),
    endsAt: new Date(String(row.ends_at)),
    activatedAt:
      row.activated_at === null ? null : new Date(String(row.activated_at)),
  }));
}

export async function getActiveAwayPeriods(
  now = new Date(),
): Promise<AwayPeriod[]> {
  const periods = await getAwayPeriods(now);
  return periods.filter(
    (period) => period.startsAt <= now && period.endsAt > now,
  );
}

export async function getDueAwayPeriods(
  now = new Date(),
): Promise<AwayPeriod[]> {
  await ensureAwayPeriodsTable();
  const rows = await queryClient`
    SELECT target_email, started_by, starts_at, ends_at, activated_at
    FROM "8slp_away_periods"
    WHERE starts_at <= ${now.toISOString()}::timestamptz
      AND ends_at > ${now.toISOString()}::timestamptz
      AND activated_at IS NULL
    ORDER BY ends_at ASC
  `;
  return rows.map((row) => ({
    targetEmail: String(row.target_email),
    startedBy: String(row.started_by),
    startsAt: new Date(String(row.starts_at)),
    endsAt: new Date(String(row.ends_at)),
    activatedAt: null,
  }));
}
