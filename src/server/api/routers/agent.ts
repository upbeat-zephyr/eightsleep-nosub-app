import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  AGENT_SCOPES,
  createAgentToken,
  listAgentTokens,
  revokeAgentToken,
} from "~/server/agentAccess";
import {
  authorizeTargetEmail,
  getHouseholdMembers,
  getSessionEmail,
} from "~/server/household";

export const agentRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    const email = await getSessionEmail(ctx.headers);
    const [members, tokens] = await Promise.all([
      getHouseholdMembers(email),
      listAgentTokens(email),
    ]);
    return { members, tokens, scopes: AGENT_SCOPES };
  }),
  create: publicProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(80),
        targetEmails: z.array(z.string().email()).min(1).max(2),
        expiresInDays: z.number().int().min(1).max(180).default(180),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const email = await getSessionEmail(ctx.headers);
      const targets = await Promise.all(
        [...new Set(input.targetEmails)].map((target) =>
          authorizeTargetEmail(email, target),
        ),
      );
      const expiresAt = new Date(
        Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
      );
      return createAgentToken({
        name: input.name,
        createdBy: email,
        expiresAt,
        grants: targets.map((targetEmail) => ({
          targetEmail,
          scopes: [...AGENT_SCOPES],
        })),
      });
    }),
  revoke: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const email = await getSessionEmail(ctx.headers);
      await revokeAgentToken(input.id, email);
      return { success: true };
    }),
});
