import { queryClient } from "~/server/db";

export type OneTimeAutomationOverride = {
  onTime: string | null;
  onLocalDate: string | null;
  offTime: string | null;
  offLocalDate: string | null;
  delayMinutes: number | null;
  timezone: string;
};

let ensureTablePromise: Promise<void> | null = null;

async function retryDb<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) =>
        setTimeout(resolve, 400 * Math.pow(2, attempt)),
      );
    }
  }
  throw lastError;
}

async function ensureAutomationOverrideTable(): Promise<void> {
  ensureTablePromise ??= retryDb(async () => {
    await queryClient`
      CREATE TABLE IF NOT EXISTS "8slp_automation_overrides" (
        email varchar(255) PRIMARY KEY REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        off_time varchar(5),
        local_date varchar(10),
        delay_minutes integer,
        on_time varchar(5),
        on_local_date varchar(10),
        timezone varchar(50) NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL
      )
    `;
    await queryClient`
      ALTER TABLE "8slp_automation_overrides"
      ADD COLUMN IF NOT EXISTS on_time varchar(5)
    `;
    await queryClient`
      ALTER TABLE "8slp_automation_overrides"
      ADD COLUMN IF NOT EXISTS on_local_date varchar(10)
    `;
    await queryClient`
      ALTER TABLE "8slp_automation_overrides"
      ALTER COLUMN off_time DROP NOT NULL
    `;
    await queryClient`
      ALTER TABLE "8slp_automation_overrides"
      ALTER COLUMN local_date DROP NOT NULL
    `;
    await queryClient`
      ALTER TABLE "8slp_automation_overrides"
      ALTER COLUMN delay_minutes DROP NOT NULL
    `;
  }).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  return ensureTablePromise;
}

export async function getOneTimeAutomationOverride(
  email: string,
): Promise<OneTimeAutomationOverride | null> {
  await ensureAutomationOverrideTable();

  const result = await retryDb(
    () => queryClient`
      SELECT
        on_time,
        on_local_date,
        off_time,
        local_date AS off_local_date,
        delay_minutes,
        timezone
      FROM "8slp_automation_overrides"
      WHERE email = ${email}
      LIMIT 1
    `,
  );
  const row = result[0];

  if (!row) {
    return null;
  }

  return {
    onTime: row.on_time === null ? null : String(row.on_time),
    onLocalDate: row.on_local_date === null ? null : String(row.on_local_date),
    offTime: row.off_time === null ? null : String(row.off_time),
    offLocalDate:
      row.off_local_date === null ? null : String(row.off_local_date),
    delayMinutes: row.delay_minutes === null ? null : Number(row.delay_minutes),
    timezone: String(row.timezone),
  };
}

export async function setOneTimeOffOverride(input: {
  email: string;
  offTime: string;
  offLocalDate: string;
  delayMinutes: number | null;
  timezone: string;
}): Promise<void> {
  await ensureAutomationOverrideTable();

  await retryDb(
    () => queryClient`
      INSERT INTO "8slp_automation_overrides" (
        email,
        off_time,
        local_date,
        delay_minutes,
        timezone,
        updated_at
      )
      VALUES (
        ${input.email},
        ${input.offTime},
        ${input.offLocalDate},
        ${input.delayMinutes},
        ${input.timezone},
        now()
      )
      ON CONFLICT (email) DO UPDATE SET
        off_time = EXCLUDED.off_time,
        local_date = EXCLUDED.local_date,
        delay_minutes = EXCLUDED.delay_minutes,
        timezone = EXCLUDED.timezone,
        updated_at = now()
    `,
  );
}

export async function setOneTimeOnOverride(input: {
  email: string;
  onTime: string;
  onLocalDate: string;
  timezone: string;
}): Promise<void> {
  await ensureAutomationOverrideTable();

  await retryDb(
    () => queryClient`
      INSERT INTO "8slp_automation_overrides" (
        email,
        on_time,
        on_local_date,
        timezone,
        updated_at
      )
      VALUES (
        ${input.email},
        ${input.onTime},
        ${input.onLocalDate},
        ${input.timezone},
        now()
      )
      ON CONFLICT (email) DO UPDATE SET
        on_time = EXCLUDED.on_time,
        on_local_date = EXCLUDED.on_local_date,
        timezone = EXCLUDED.timezone,
        updated_at = now()
    `,
  );
}

export async function clearOneTimeOffOverride(email: string): Promise<void> {
  await ensureAutomationOverrideTable();

  await retryDb(
    () => queryClient`
      UPDATE "8slp_automation_overrides"
      SET off_time = NULL,
          local_date = NULL,
          delay_minutes = NULL,
          updated_at = now()
      WHERE email = ${email}
    `,
  );
  await deleteEmptyOverride(email);
}

export async function clearOneTimeOnOverride(email: string): Promise<void> {
  await ensureAutomationOverrideTable();

  await retryDb(
    () => queryClient`
      UPDATE "8slp_automation_overrides"
      SET on_time = NULL,
          on_local_date = NULL,
          updated_at = now()
      WHERE email = ${email}
    `,
  );
  await deleteEmptyOverride(email);
}

export async function clearOneTimeAutomationOverride(
  email: string,
): Promise<void> {
  await ensureAutomationOverrideTable();

  await retryDb(
    () => queryClient`
      DELETE FROM "8slp_automation_overrides"
      WHERE email = ${email}
    `,
  );
}

async function deleteEmptyOverride(email: string): Promise<void> {
  await retryDb(
    () => queryClient`
      DELETE FROM "8slp_automation_overrides"
      WHERE email = ${email}
        AND on_time IS NULL
        AND on_local_date IS NULL
        AND off_time IS NULL
        AND local_date IS NULL
    `,
  );
}
