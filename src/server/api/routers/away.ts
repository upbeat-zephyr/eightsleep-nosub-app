import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { clearAwayPeriod, getActiveAwayPeriods } from "~/server/awayPeriods";
import {
  authorizeTargetEmail,
  getHouseholdMembers,
  getSessionEmail,
} from "~/server/household";
import { startAwayForTarget } from "~/server/napControl";

const targetEmailsSchema = z.array(z.string().email()).min(1).max(2);

export const awayRouter = createTRPCRouter({
  status: publicProcedure.query(async ({ ctx }) => {
    const requesterEmail = await getSessionEmail(ctx.headers);
    const members = await getHouseholdMembers(requesterEmail);
    const visibleEmails = new Set(members.map((member) => member.email));
    const periods = (await getActiveAwayPeriods())
      .filter((period) => visibleEmails.has(period.targetEmail))
      .map((period) => ({
        targetEmail: period.targetEmail,
        endsAt: period.endsAt.toISOString(),
      }));
    return { periods };
  }),
  start: publicProcedure
    .input(
      z.object({
        targetEmails: targetEmailsSchema,
        endsAt: z.string().datetime(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const requesterEmail = await getSessionEmail(ctx.headers);
      const targetEmails = await Promise.all(
        [...new Set(input.targetEmails)].map((email) =>
          authorizeTargetEmail(requesterEmail, email),
        ),
      );
      const endsAt = new Date(input.endsAt);
      if (endsAt.getTime() <= Date.now() + 15 * 60 * 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Choose a return time at least 15 minutes from now.",
        });
      }
      if (endsAt.getTime() > Date.now() + 365 * 24 * 60 * 60 * 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Away mode can be scheduled for up to one year.",
        });
      }

      const results = await Promise.allSettled(
        targetEmails.map(async (targetEmail) => {
          await startAwayForTarget({
            targetEmail,
            startedBy: requesterEmail,
            endsAt,
          });
        }),
      );
      const started = results.flatMap((result, index) =>
        result.status === "fulfilled" ? [targetEmails[index]!] : [],
      );
      const failed = results.flatMap((result, index) =>
        result.status === "rejected" ? [targetEmails[index]!] : [],
      );
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          console.error(
            `Failed to start away mode for ${targetEmails[index]}:`,
            result.reason,
          );
        }
      });
      if (started.length === 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Away mode could not switch the selected side off.",
        });
      }
      return { started, failed, endsAt: endsAt.toISOString() };
    }),
  clear: publicProcedure
    .input(z.object({ targetEmails: targetEmailsSchema }))
    .mutation(async ({ ctx, input }) => {
      const requesterEmail = await getSessionEmail(ctx.headers);
      const targetEmails = await Promise.all(
        [...new Set(input.targetEmails)].map((email) =>
          authorizeTargetEmail(requesterEmail, email),
        ),
      );
      await Promise.all(targetEmails.map(clearAwayPeriod));
      return { success: true };
    }),
});
