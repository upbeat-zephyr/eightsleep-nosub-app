import { queryClient } from "~/server/db";

export type TemperatureScheduleStep = {
  time: string;
  level: number;
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

async function ensureTemperatureScheduleTable(): Promise<void> {
  ensureTablePromise ??= retryDb(async () => {
    await queryClient`
      CREATE TABLE IF NOT EXISTS "8slp_temperature_schedule_steps" (
        email varchar(255) NOT NULL REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        position integer NOT NULL,
        time varchar(5) NOT NULL,
        level integer NOT NULL,
        created_at timestamp DEFAULT now() NOT NULL,
        updated_at timestamp DEFAULT now() NOT NULL,
        PRIMARY KEY (email, position)
      )
    `;
  }).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  return ensureTablePromise;
}

export async function getTemperatureScheduleSteps(
  email: string,
): Promise<TemperatureScheduleStep[]> {
  await ensureTemperatureScheduleTable();

  const result = await retryDb(
    () => queryClient`
      SELECT time, level
      FROM "8slp_temperature_schedule_steps"
      WHERE email = ${email}
      ORDER BY position ASC
    `,
  );

  return result.map((row) => ({
    time: String(row.time),
    level: Number(row.level),
  }));
}

export async function replaceTemperatureScheduleSteps(
  email: string,
  steps: TemperatureScheduleStep[],
): Promise<void> {
  await ensureTemperatureScheduleTable();

  await retryDb(async () => {
    await queryClient.begin(async (transaction) => {
      await transaction`
      DELETE FROM "8slp_temperature_schedule_steps"
      WHERE email = ${email}
    `;

      for (const [index, step] of steps.entries()) {
        await transaction`
        INSERT INTO "8slp_temperature_schedule_steps" (
          email,
          position,
          time,
          level,
          updated_at
        )
        VALUES (
          ${email},
          ${index},
          ${step.time},
          ${step.level},
          now()
        )
      `;
      }
    });
  });
}
