import { sql } from "@vercel/postgres";

export type OneTimeOffOverride = {
  offTime: string;
  localDate: string;
  delayMinutes: number;
  timezone: string;
};

let ensureTablePromise: Promise<void> | null = null;

async function ensureAutomationOverrideTable(): Promise<void> {
  ensureTablePromise ??= sql`
    CREATE TABLE IF NOT EXISTS "8slp_automation_overrides" (
      email varchar(255) PRIMARY KEY REFERENCES "8slp_users"(email) ON DELETE CASCADE,
      off_time varchar(5) NOT NULL,
      local_date varchar(10) NOT NULL,
      delay_minutes integer NOT NULL,
      timezone varchar(50) NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL,
      updated_at timestamp DEFAULT now() NOT NULL
    )
  `.then(() => undefined);

  return ensureTablePromise;
}

export async function getOneTimeOffOverride(
  email: string,
): Promise<OneTimeOffOverride | null> {
  await ensureAutomationOverrideTable();

  const result = await sql`
    SELECT off_time, local_date, delay_minutes, timezone
    FROM "8slp_automation_overrides"
    WHERE email = ${email}
    LIMIT 1
  `;
  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    offTime: String(row.off_time),
    localDate: String(row.local_date),
    delayMinutes: Number(row.delay_minutes),
    timezone: String(row.timezone),
  };
}

export async function setOneTimeOffOverride(input: {
  email: string;
  offTime: string;
  localDate: string;
  delayMinutes: number;
  timezone: string;
}): Promise<void> {
  await ensureAutomationOverrideTable();

  await sql`
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
      ${input.localDate},
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
  `;
}

export async function clearOneTimeOffOverride(email: string): Promise<void> {
  await ensureAutomationOverrideTable();

  await sql`
    DELETE FROM "8slp_automation_overrides"
    WHERE email = ${email}
  `;
}
