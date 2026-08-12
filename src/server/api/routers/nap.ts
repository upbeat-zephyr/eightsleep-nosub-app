import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import {
  authorizeTargetEmail,
  getHouseholdMembers,
  getSessionEmail,
  isHouseholdManager,
} from "~/server/household";
import { startNapForTarget, stopNapForTarget } from "~/server/napControl";
import { getNapSessions } from "~/server/napSessions";

const targetEmailsSchema = z.array(z.string().email()).min(1).max(2);

export const napRouter = createTRPCRouter({
  dashboard: publicProcedure.query(async ({ ctx }) => {
    const requesterEmail = await getSessionEmail(ctx.headers);
    const members = await getHouseholdMembers(requesterEmail);
    const visibleEmails = new Set(members.map((member) => member.email));
    let savedSessions: Awaited<ReturnType<typeof getNapSessions>> = [];
    try {
      savedSessions = await getNapSessions();
    } catch (error) {
      console.error("Failed to load nap sessions:", error);
    }
    const sessions = savedSessions
      .filter((session) => visibleEmails.has(session.targetEmail))
      .map((session) => ({
        targetEmail: session.targetEmail,
        temperature: Math.round(session.temperature / 10),
        startedAt: session.startedAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
      }));

    return {
      members,
      canManageHousehold: isHouseholdManager(requesterEmail),
      sessions,
    };
  }),
  start: publicProcedure
    .input(
      z.object({
        targetEmails: targetEmailsSchema,
        temperature: z.number().int().min(-10).max(10),
        durationMinutes: z
          .number()
          .int()
          .min(15)
          .max(8 * 60),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const requesterEmail = await getSessionEmail(ctx.headers);
      const targetEmails = await Promise.all(
        [...new Set(input.targetEmails)].map((email) =>
          authorizeTargetEmail(requesterEmail, email),
        ),
      );
      const results = await Promise.allSettled(
        targetEmails.map((targetEmail) =>
          startNapForTarget({
            startedBy: requesterEmail,
            targetEmail,
            temperature: input.temperature,
            durationMinutes: input.durationMinutes,
          }),
        ),
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
            `Failed to start nap for ${targetEmails[index]}:`,
            result.reason,
          );
        }
      });

      if (started.length === 0) {
        const firstFailure = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        const reason =
          firstFailure?.reason instanceof Error
            ? firstFailure.reason.message
            : "Eight Sleep could not be reached";
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Eight Sleep did not start the nap: ${reason}.`,
        });
      }
      return { started, failed };
    }),
  stop: publicProcedure
    .input(z.object({ targetEmails: targetEmailsSchema }))
    .mutation(async ({ ctx, input }) => {
      const requesterEmail = await getSessionEmail(ctx.headers);
      const targetEmails = await Promise.all(
        [...new Set(input.targetEmails)].map((email) =>
          authorizeTargetEmail(requesterEmail, email),
        ),
      );
      await Promise.all(
        targetEmails.map((targetEmail) => stopNapForTarget(targetEmail)),
      );
      return { success: true };
    }),
});
