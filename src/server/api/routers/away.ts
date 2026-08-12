import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { getAwayPeriods } from "~/server/awayPeriods";
import {
  authorizeTargetEmail,
  getHouseholdMembers,
  getSessionEmail,
} from "~/server/household";
import { clearAwayForTarget, startAwayForTarget } from "~/server/napControl";

const targetEmailsSchema = z.array(z.string().email()).min(1).max(2);

export const awayRouter = createTRPCRouter({
  status: publicProcedure.query(async ({ ctx }) => {
    const requesterEmail = await getSessionEmail(ctx.headers);
    const members = await getHouseholdMembers(requesterEmail);
    const visibleEmails = new Set(members.map((member) => member.email));
    const periods = (await getAwayPeriods())
      .filter((period) => visibleEmails.has(period.targetEmail))
      .map((period) => ({
        targetEmail: period.targetEmail,
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt.toISOString(),
        active: period.startsAt <= new Date(),
      }));
    return { periods };
  }),
  start: publicProcedure
    .input(
      z.object({
        targetEmails: targetEmailsSchema,
        startsAt: z.string().datetime(),
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
      const startsAt = new Date(input.startsAt);
      const endsAt = new Date(input.endsAt);
      if (startsAt.getTime() < Date.now() - 26 * 60 * 60 * 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The Away start date cannot be in the past.",
        });
      }
      if (endsAt.getTime() <= startsAt.getTime() + 15 * 60 * 1000) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Return home must be after Away starts.",
        });
      }
      if (endsAt.getTime() > startsAt.getTime() + 365 * 24 * 60 * 60 * 1000) {
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
            startsAt,
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
      return {
        started,
        failed,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
      };
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
      await Promise.all(targetEmails.map(clearAwayForTarget));
      return { success: true };
    }),
});
