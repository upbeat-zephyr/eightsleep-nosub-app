import { z } from "zod";
import {
  AgentApiError,
  authenticateAgent,
  completeAgentRequest,
  enforceAgentRateLimit,
  hasGrant,
  requestHash,
  reserveAgentRequest,
  writeAudit,
  type AgentPrincipal,
  type AgentScope,
} from "~/server/agentAccess";
import {
  clearAwayForTarget,
  clearOneTimeAutomationOverride,
  getAgentState,
  setAgentOneTime,
  setDirectPower,
  setDirectTemperature,
  startAwayForTarget,
  startNapForTarget,
  stopNapForTarget,
  updateAgentSchedule,
} from "~/server/agentOperations";

export const runtime = "nodejs";
export const maxDuration = 60;

const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const timezone = z
  .string()
  .min(1)
  .max(50)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  });
const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === value
    );
  });
const base = z.object({
  operation: z.string(),
  targetEmail: z.string().email(),
});
const commandSchema = z.discriminatedUnion("operation", [
  base.extend({ operation: z.literal("state.get") }),
  base.extend({
    operation: z.literal("schedule.update"),
    schedule: z.object({
      onTime: time,
      offTime: time,
      timezone,
      initialTemperature: z.number().int().min(-10).max(10),
      temperatureSteps: z
        .array(
          z.object({ time, temperature: z.number().int().min(-10).max(10) }),
        )
        .max(12),
    }),
  }),
  base.extend({
    operation: z.literal("once.set"),
    onTime: time.optional(),
    offTime: time.optional(),
    timezone,
    localDate,
  }),
  base.extend({ operation: z.literal("once.clear") }),
  base.extend({
    operation: z.literal("nap.start"),
    temperature: z.number().int().min(-10).max(10),
    durationMinutes: z.number().int().min(15).max(480),
  }),
  base.extend({ operation: z.literal("nap.stop") }),
  base.extend({
    operation: z.literal("away.schedule"),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
  }),
  base.extend({ operation: z.literal("away.clear") }),
  base.extend({
    operation: z.literal("power.set"),
    state: z.enum(["on", "off"]),
  }),
  base.extend({
    operation: z.literal("temperature.set"),
    temperature: z.number().int().min(-10).max(10),
    durationMinutes: z.number().int().min(15).max(480).optional(),
  }),
]);

type Command = z.infer<typeof commandSchema>;

const scopeByOperation: Record<Command["operation"], AgentScope> = {
  "state.get": "state:read",
  "schedule.update": "automation:write",
  "once.set": "automation:write",
  "once.clear": "automation:write",
  "nap.start": "nap:write",
  "nap.stop": "nap:write",
  "away.schedule": "away:write",
  "away.clear": "away:write",
  "power.set": "power:write",
  "temperature.set": "temperature:write",
};

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, { status, headers });
}

async function getPrincipal(request: Request): Promise<AgentPrincipal> {
  const principal = await authenticateAgent(
    request.headers.get("authorization"),
  );
  if (!principal) throw new AgentApiError(401, "unauthorized");
  await enforceAgentRateLimit(principal.id);
  return principal;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await getPrincipal(request);
    return json({
      apiVersion: "v1",
      principal: { id: principal.id, name: principal.name },
      grants: principal.grants,
      operations: Object.keys(scopeByOperation),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  let principal: AgentPrincipal | null = null;
  let command: Command | null = null;
  let idempotencyKey: string | null = null;
  let reservationOwned = false;
  let reservedHash: string | null = null;
  let executionStarted = false;
  try {
    principal = await getPrincipal(request);
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 16_384)
      throw new AgentApiError(413, "request_too_large");
    const rawBody = await readLimitedBody(request, 16_384);
    command = commandSchema.parse(JSON.parse(rawBody));
    if (
      command.operation === "once.set" &&
      !command.onTime &&
      !command.offTime
    ) {
      throw new AgentApiError(400, "once_time_required");
    }
    validateCommandSemantics(command);
    const scope = scopeByOperation[command.operation];
    if (!hasGrant(principal, command.targetEmail, scope)) {
      throw new AgentApiError(403, "forbidden");
    }

    if (command.operation === "state.get") {
      const result = await getAgentState(command.targetEmail);
      await writeAudit({
        tokenId: principal.id,
        actorEmail: principal.createdBy,
        targetEmail: command.targetEmail,
        operation: command.operation,
        outcome: "succeeded",
        httpStatus: 200,
      });
      return json({ ok: true, result });
    }

    idempotencyKey = request.headers.get("idempotency-key");
    if (!idempotencyKey || !/^[\x21-\x7E]{8,128}$/.test(idempotencyKey)) {
      throw new AgentApiError(428, "idempotency_key_required");
    }
    const hash = requestHash(command.operation, command.targetEmail, command);
    reservedHash = hash;
    const reservation = await reserveAgentRequest({
      tokenId: principal.id,
      key: idempotencyKey,
      hash,
    });
    if (reservation.replay) {
      return json(reservation.body, reservation.status, {
        "idempotency-replayed": "true",
      });
    }
    reservationOwned = true;

    executionStarted = true;
    const result = await execute(command, principal.createdBy);
    const body = {
      ok: true,
      operation: command.operation,
      targetEmail: command.targetEmail,
      result,
    };
    await completeAgentRequest({
      tokenId: principal.id,
      key: idempotencyKey,
      state: "succeeded",
      status: 200,
      body,
      hash,
    }).catch(() => {
      throw new AgentApiError(503, "request_indeterminate");
    });
    await writeAudit({
      tokenId: principal.id,
      actorEmail: principal.createdBy,
      targetEmail: command.targetEmail,
      operation: command.operation,
      outcome: "succeeded",
      httpStatus: 200,
    }).catch(() => undefined);
    return json(body);
  } catch (error) {
    let response = errorResponse(error);
    if (
      principal &&
      command &&
      idempotencyKey &&
      reservationOwned &&
      reservedHash &&
      executionStarted
    ) {
      const body = { ok: false, error: "request_indeterminate" };
      await completeAgentRequest({
        tokenId: principal.id,
        key: idempotencyKey,
        state: "indeterminate",
        status: 503,
        body,
        hash: reservedHash,
      }).catch(() => undefined);
      response = json(body, 503);
    }
    if (
      principal &&
      command &&
      idempotencyKey &&
      reservationOwned &&
      reservedHash &&
      !executionStarted
    ) {
      const parsedBody: unknown = await response
        .clone()
        .json()
        .catch(() => ({ ok: false, error: "failed" }));
      await completeAgentRequest({
        tokenId: principal.id,
        key: idempotencyKey,
        state: "failed",
        status: response.status,
        body: parsedBody,
        hash: reservedHash,
      }).catch(() => undefined);
    }
    if (principal) {
      await writeAudit({
        tokenId: principal.id,
        actorEmail: principal.createdBy,
        targetEmail: command?.targetEmail,
        operation: command?.operation ?? "request.invalid",
        outcome: executionStarted ? "indeterminate" : "failed",
        httpStatus: response.status,
      }).catch(() => undefined);
    }
    return response;
  }
}

async function readLimitedBody(
  request: Request,
  limit: number,
): Promise<string> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new AgentApiError(413, "request_too_large");
    }
    body += decoder.decode(value, { stream: true });
  }
  return body + decoder.decode();
}

async function execute(command: Command, actorEmail: string): Promise<unknown> {
  switch (command.operation) {
    case "schedule.update":
      await updateAgentSchedule(command.targetEmail, command.schedule);
      return { saved: true };
    case "once.set":
      await setAgentOneTime(command.targetEmail, command);
      return { saved: true };
    case "once.clear":
      await clearOneTimeAutomationOverride(command.targetEmail);
      return { cleared: true };
    case "nap.start":
      return startNapForTarget({
        startedBy: actorEmail,
        targetEmail: command.targetEmail,
        temperature: command.temperature,
        durationMinutes: command.durationMinutes,
      });
    case "nap.stop":
      await stopNapForTarget(command.targetEmail);
      return { stopped: true };
    case "away.schedule": {
      const startsAt = new Date(command.startsAt);
      const endsAt = new Date(command.endsAt);
      await startAwayForTarget({
        startedBy: actorEmail,
        targetEmail: command.targetEmail,
        startsAt,
        endsAt,
      });
      return { scheduled: true };
    }
    case "away.clear":
      await clearAwayForTarget(command.targetEmail);
      return { cleared: true };
    case "power.set":
      await setDirectPower(command.targetEmail, command.state);
      return { state: command.state };
    case "temperature.set":
      await setDirectTemperature(
        command.targetEmail,
        command.temperature,
        command.durationMinutes,
      );
      return {
        temperature: command.temperature,
        durationMinutes: command.durationMinutes ?? null,
      };
    case "state.get":
      return getAgentState(command.targetEmail);
  }
}

function validateCommandSemantics(command: Command): void {
  if (command.operation !== "away.schedule") return;
  const startsAt = new Date(command.startsAt);
  const endsAt = new Date(command.endsAt);
  if (
    startsAt.getTime() < Date.now() - 26 * 60 * 60 * 1000 ||
    endsAt.getTime() <= startsAt.getTime() + 15 * 60 * 1000 ||
    endsAt.getTime() > startsAt.getTime() + 365 * 24 * 60 * 60 * 1000
  ) {
    throw new AgentApiError(400, "invalid_away_range");
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof AgentApiError) {
    return json({ ok: false, error: error.code }, error.status, {
      ...(error.status === 401 ? { "www-authenticate": "Bearer" } : {}),
      ...(error.status === 429 ? { "retry-after": "60" } : {}),
    });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return json({ ok: false, error: "invalid_request" }, 400);
  }
  console.error("Agent API request failed:", error);
  return json({ ok: false, error: "operation_failed" }, 502);
}
