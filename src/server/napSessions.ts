import { queryClient } from "~/server/db";

export type NapSession = {
  id: string;
  startedBy: string;
  targetEmail: string;
  temperature: number;
  startedAt: Date;
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

export async function ensureNapSessionsTable(): Promise<void> {
  ensureTablePromise ??= retryDb(async () => {
    await queryClient`
      CREATE TABLE IF NOT EXISTS "8slp_nap_sessions" (
        id varchar(36) NOT NULL,
        started_by varchar(255) NOT NULL REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        target_email varchar(255) PRIMARY KEY REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        temperature integer NOT NULL,
        started_at timestamptz NOT NULL,
        ends_at timestamptz NOT NULL
      )
    `;
  }).catch((error) => {
    ensureTablePromise = null;
    throw error;
  });

  return ensureTablePromise;
}

function mapSession(row: Record<string, unknown>): NapSession {
  return {
    id: String(row.id),
    startedBy: String(row.started_by),
    targetEmail: String(row.target_email),
    temperature: Number(row.temperature),
    startedAt: new Date(String(row.started_at)),
    endsAt: new Date(String(row.ends_at)),
  };
}

export async function getNapSessions(): Promise<NapSession[]> {
  await ensureNapSessionsTable();
  const rows = await queryClient`
    SELECT id, started_by, target_email, temperature, started_at, ends_at
    FROM "8slp_nap_sessions"
    ORDER BY ends_at ASC
  `;
  return rows.map((row) => mapSession(row));
}
