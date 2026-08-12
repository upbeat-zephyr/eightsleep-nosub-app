import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import { queryClient } from "~/server/db";

export const AGENT_SCOPES = [
  "state:read",
  "automation:write",
  "nap:write",
  "away:write",
  "power:write",
  "temperature:write",
] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export type AgentPrincipal = {
  id: string;
  name: string;
  createdBy: string;
  grants: Array<{ targetEmail: string; scope: AgentScope }>;
};

let ensureTablesPromise: Promise<void> | null = null;

export async function ensureAgentTables(): Promise<void> {
  ensureTablesPromise ??= queryClient
    .begin(async (sql) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext('8slp_agent_schema_v1'))`;
      await sql`
      CREATE TABLE IF NOT EXISTS "8slp_agent_tokens" (
        id uuid PRIMARY KEY,
        token_hash varchar(64) NOT NULL UNIQUE,
        name varchar(80) NOT NULL,
        created_by varchar(255) NOT NULL REFERENCES "8slp_users"(email) ON DELETE RESTRICT,
        created_at timestamptz DEFAULT now() NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_used_at timestamptz
      )
    `;
      await sql`
      CREATE TABLE IF NOT EXISTS "8slp_agent_grants" (
        token_id uuid NOT NULL REFERENCES "8slp_agent_tokens"(id) ON DELETE CASCADE,
        target_email varchar(255) NOT NULL REFERENCES "8slp_users"(email) ON DELETE CASCADE,
        scope varchar(40) NOT NULL,
        PRIMARY KEY (token_id, target_email, scope)
      )
    `;
      await sql`
      CREATE TABLE IF NOT EXISTS "8slp_agent_requests" (
        token_id uuid NOT NULL REFERENCES "8slp_agent_tokens"(id) ON DELETE RESTRICT,
        idempotency_key varchar(128) NOT NULL,
        request_hash varchar(64) NOT NULL,
        state varchar(16) NOT NULL,
        response_status integer,
        response_body jsonb,
        started_at timestamptz DEFAULT now() NOT NULL,
        completed_at timestamptz,
        PRIMARY KEY (token_id, idempotency_key)
      )
    `;
      await sql`
      CREATE TABLE IF NOT EXISTS "8slp_agent_audit" (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        token_id uuid,
        actor_email varchar(255),
        target_email varchar(255),
        operation varchar(80) NOT NULL,
        outcome varchar(24) NOT NULL,
        http_status integer NOT NULL,
        metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL
      )
    `;
      await sql`
      CREATE INDEX IF NOT EXISTS "8slp_agent_audit_created_idx"
      ON "8slp_agent_audit" (created_at DESC)
    `;
      await sql`
      CREATE TABLE IF NOT EXISTS "8slp_agent_rate_limits" (
        token_id uuid NOT NULL,
        window_start timestamptz NOT NULL,
        request_count integer NOT NULL,
        PRIMARY KEY (token_id, window_start)
      )
    `;
    })
    .then(() => undefined)
    .catch((error) => {
      ensureTablesPromise = null;
      throw error;
    });
  return ensureTablesPromise;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export async function createAgentToken(input: {
  name: string;
  createdBy: string;
  expiresAt: Date;
  grants: Array<{ targetEmail: string; scopes: AgentScope[] }>;
}): Promise<{ id: string; token: string }> {
  await ensureAgentTables();
  const id = randomUUID();
  const token = `8slp_pat_v1.${id}.${randomBytes(32).toString("base64url")}`;
  await queryClient.begin(async (sql) => {
    await sql`
      INSERT INTO "8slp_agent_tokens" (id, token_hash, name, created_by, expires_at)
      VALUES (${id}, ${hashToken(token)}, ${input.name}, ${input.createdBy}, ${input.expiresAt.toISOString()}::timestamptz)
    `;
    for (const grant of input.grants) {
      for (const scope of grant.scopes) {
        await sql`
          INSERT INTO "8slp_agent_grants" (token_id, target_email, scope)
          VALUES (${id}, ${grant.targetEmail}, ${scope})
        `;
      }
    }
  });
  await writeAudit({
    tokenId: id,
    actorEmail: input.createdBy,
    operation: "token.create",
    outcome: "succeeded",
    httpStatus: 201,
    metadata: {
      name: input.name,
      targets: input.grants.map((grant) => grant.targetEmail),
    },
  });
  return { id, token };
}

export async function listAgentTokens(createdBy: string) {
  await ensureAgentTables();
  const rows = await queryClient`
    SELECT id, name, created_at, expires_at, revoked_at, last_used_at
    FROM "8slp_agent_tokens"
    WHERE created_by = ${createdBy}
    ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    revokedAt: row.revoked_at
      ? new Date(String(row.revoked_at)).toISOString()
      : null,
    lastUsedAt: row.last_used_at
      ? new Date(String(row.last_used_at)).toISOString()
      : null,
  }));
}

export async function revokeAgentToken(
  id: string,
  createdBy: string,
): Promise<void> {
  await ensureAgentTables();
  const rows = await queryClient`
    UPDATE "8slp_agent_tokens"
    SET revoked_at = COALESCE(revoked_at, now())
    WHERE id = ${id} AND created_by = ${createdBy}
    RETURNING id
  `;
  if (rows.length === 0) throw new AgentApiError(404, "token_not_found");
  await writeAudit({
    tokenId: id,
    actorEmail: createdBy,
    operation: "token.revoke",
    outcome: "succeeded",
    httpStatus: 204,
  });
}

export async function authenticateAgent(
  header: string | null,
): Promise<AgentPrincipal | null> {
  await ensureAgentTables();
  if (!header?.startsWith("Bearer ") || header.length > 512) return null;
  const token = header.slice(7);
  const match =
    /^8slp_pat_v1\.([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{40,})$/.exec(
      token,
    );
  if (!match) return null;
  const id = match[1]!;
  const rows = await queryClient`
    SELECT id, token_hash, name, created_by
    FROM "8slp_agent_tokens"
    WHERE id = ${id} AND revoked_at IS NULL AND expires_at > now()
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  const expected = Buffer.from(String(row.token_hash), "hex");
  const actual = Buffer.from(hashToken(token), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return null;
  const grantRows = await queryClient`
    SELECT target_email, scope FROM "8slp_agent_grants" WHERE token_id = ${id}
  `;
  await queryClient`
    UPDATE "8slp_agent_tokens" SET last_used_at = now() WHERE id = ${id}
  `;
  return {
    id,
    name: String(row.name),
    createdBy: String(row.created_by),
    grants: grantRows.map((grant) => ({
      targetEmail: String(grant.target_email),
      scope: String(grant.scope) as AgentScope,
    })),
  };
}

export function hasGrant(
  principal: AgentPrincipal,
  targetEmail: string,
  scope: AgentScope,
): boolean {
  return principal.grants.some(
    (grant) => grant.targetEmail === targetEmail && grant.scope === scope,
  );
}

export function requestHash(
  operation: string,
  targetEmail: string,
  input: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, targetEmail, input }), "utf8")
    .digest("hex");
}

export async function reserveAgentRequest(input: {
  tokenId: string;
  key: string;
  hash: string;
}): Promise<{ replay: boolean; status?: number; body?: unknown }> {
  await ensureAgentTables();
  const inserted = await queryClient`
    INSERT INTO "8slp_agent_requests" (token_id, idempotency_key, request_hash, state)
    VALUES (${input.tokenId}, ${input.key}, ${input.hash}, 'in_progress')
    ON CONFLICT DO NOTHING
    RETURNING token_id
  `;
  if (inserted.length > 0) return { replay: false };
  const rows = await queryClient`
    SELECT request_hash, state, response_status, response_body
    FROM "8slp_agent_requests"
    WHERE token_id = ${input.tokenId} AND idempotency_key = ${input.key}
  `;
  const row = rows[0];
  if (!row || row.request_hash !== input.hash)
    throw new AgentApiError(409, "idempotency_conflict");
  if (row.state === "in_progress") {
    const stale = await queryClient`
      UPDATE "8slp_agent_requests"
      SET state = 'indeterminate', response_status = 409,
          response_body = '{"ok":false,"error":"request_indeterminate"}'::jsonb,
          completed_at = now()
      WHERE token_id = ${input.tokenId} AND idempotency_key = ${input.key}
        AND state = 'in_progress' AND started_at < now() - interval '2 minutes'
      RETURNING response_body
    `;
    if (stale.length > 0) {
      return { replay: true, status: 409, body: stale[0]?.response_body };
    }
    throw new AgentApiError(409, "request_in_progress");
  }
  return {
    replay: true,
    status: Number(row.response_status),
    body: row.response_body,
  };
}

export async function completeAgentRequest(input: {
  tokenId: string;
  key: string;
  state: "succeeded" | "failed" | "indeterminate";
  status: number;
  body: unknown;
  hash: string;
}): Promise<void> {
  const rows = await queryClient`
    UPDATE "8slp_agent_requests"
    SET state = ${input.state}, response_status = ${input.status}, response_body = ${JSON.stringify(input.body)}::jsonb,
        completed_at = now()
    WHERE token_id = ${input.tokenId} AND idempotency_key = ${input.key}
      AND request_hash = ${input.hash} AND state = 'in_progress'
    RETURNING token_id
  `;
  if (rows.length === 0) throw new AgentApiError(503, "request_indeterminate");
}

export async function enforceAgentRateLimit(tokenId: string): Promise<void> {
  const rows = await queryClient`
    INSERT INTO "8slp_agent_rate_limits" (token_id, window_start, request_count)
    VALUES (${tokenId}, date_trunc('minute', now()), 1)
    ON CONFLICT (token_id, window_start) DO UPDATE SET
      request_count = "8slp_agent_rate_limits".request_count + 1
    RETURNING request_count
  `;
  if (Number(rows[0]?.request_count ?? 0) > 30)
    throw new AgentApiError(429, "rate_limited");
}

export async function writeAudit(input: {
  tokenId?: string;
  actorEmail?: string;
  targetEmail?: string;
  operation: string;
  outcome: string;
  httpStatus: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await ensureAgentTables();
  await queryClient`
    INSERT INTO "8slp_agent_audit" (
      token_id, actor_email, target_email, operation, outcome, http_status, metadata
    ) VALUES (
      ${input.tokenId ?? null}, ${input.actorEmail ?? null}, ${input.targetEmail ?? null},
      ${input.operation}, ${input.outcome}, ${input.httpStatus},
      ${JSON.stringify(input.metadata ?? {})}::jsonb
    )
  `;
}

export class AgentApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
