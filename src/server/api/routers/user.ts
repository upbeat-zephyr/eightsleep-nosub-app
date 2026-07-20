import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { db } from "~/server/db";
import { userTemperatureProfile, users } from "~/server/db/schema";
import { cookies } from "next/headers";
import {
  authenticate,
  obtainFreshAccessToken,
  AuthError,
} from "~/server/eight/auth";
import { eq } from "drizzle-orm";
import { type Token } from "~/server/eight/types";
import { TRPCError } from "@trpc/server";
import jwt from "jsonwebtoken";
import {
  clearOneTimeAutomationOverride,
  clearOneTimeOffOverride,
  clearOneTimeOnOverride,
  getOneTimeAutomationOverride,
  setOneTimeOffOverride,
  setOneTimeOnOverride,
  type OneTimeAutomationOverride,
} from "~/server/automationOverrides";
import {
  getTemperatureScheduleSteps,
  replaceTemperatureScheduleSteps,
} from "~/server/temperatureSchedule";

class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseError";
  }
}

const checkAuthCookie = async (headers: Headers) => {
  const cookies = headers.get("cookie");
  console.log("Checking cookies");
  if (!cookies) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }

  const token = cookies
    .split("; ")
    .find((row) => row.startsWith("8slpAutht="))
    ?.split("=")[1];
  console.log("Token:", token);

  if (!token) {
    throw new AuthError(`Auth request failed. No cookies found.`, 401);
  }
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      email: string;
    };
  } catch {
    throw new AuthError(`Auth request failed. Invalid token.`, 401);
  }

  return decoded;
};

function localNow(timezone: string): Date {
  return new Date(new Date().toLocaleString("en-US", { timeZone: timezone }));
}

function createLocalDateWithTime(baseDate: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  if (
    hours === undefined ||
    minutes === undefined ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    throw new Error(`Invalid time: ${time}`);
  }

  const date = new Date(baseDate);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatLocalTime(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function nextLocalDateTime(now: Date, time: string): Date {
  const target = createLocalDateWithTime(now, time);
  if (target.getTime() < now.getTime() - 15 * 60 * 1000) {
    target.setDate(target.getDate() + 1);
  }
  return target;
}

export const userRouter = createTRPCRouter({
  checkLoginState: publicProcedure.query(async ({ ctx }) => {
    try {
      let decoded;
      try {
        decoded = await checkAuthCookie(ctx.headers);
      } catch (error) {
        if (error instanceof AuthError) {
          return { loginRequired: true };
        }
        throw error;
      }
      const email = decoded.email;

      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, email))
        .execute();

      if (userList.length !== 1 || userList[0] === undefined) {
        return { loginRequired: true };
      }

      const user = userList[0];

      // check if token is expired, and if so, refresh it
      if (user.eightTokenExpiresAt < new Date()) {
        console.log("Token expired, refreshing for user", user.email);
        try {
          const {
            eightAccessToken,
            eightRefreshToken,
            eightExpiresAtPosix: expiresAt,
          } = await obtainFreshAccessToken(
            user.eightRefreshToken,
            user.eightUserId,
          );

          await db
            .update(users)
            .set({
              eightAccessToken,
              eightRefreshToken,
              eightTokenExpiresAt: new Date(expiresAt),
            })
            .where(eq(users.email, email))
            .execute();

          return { loginRequired: false };
        } catch (error) {
          console.error("Token renewal failed:", error);
          return { loginRequired: true };
        }
      }
      return { loginRequired: false };
    } catch (error) {
      console.error("Error in checkLoginState:", error);
      throw new Error(
        "An unexpected error occurred while checking login state.",
      );
    }
  }),

  login: publicProcedure
    .input(
      z.object({
        email: z.string().email(),
        password: z.string(),
      }),
    )
    .mutation(async ({ input }) => {
      try {
        const authResult = await authenticateUser(input.email, input.password);

        const approvedEmails = process.env
          .APPROVED_EMAILS!.split(",")
          .map((email) => email.toLowerCase());

        if (!approvedEmails.includes(input.email.toLowerCase())) {
          throw new AuthError("Email not approved");
        }

        await saveUserToDatabase(input.email, authResult);

        const jwtSecret = process.env.JWT_SECRET;
        if (!jwtSecret) {
          throw new Error("JWT_SECRET is not defined in the environment");
        }

        const token = jwt.sign({ email: input.email }, jwtSecret, {
          expiresIn: "90d",
        });
        const threeMonthsInSeconds = 90 * 24 * 60 * 60; // 90 days

        cookies().set("8slpAutht", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "strict",
          maxAge: threeMonthsInSeconds,
          path: "/",
        });
        console.log("Saving token to cookie.");

        // Set HTTP-only cookie
        return {
          success: true,
        };
      } catch (error) {
        console.error("Error in login process:", error);
        if (error instanceof AuthError) {
          throw new Error(`Authentication failed: ${error.message}`);
        } else if (error instanceof DatabaseError) {
          throw new Error(
            "Failed to save login information. Please try again.",
          );
        } else {
          throw new Error(
            "An unexpected error occurred. Please try again later.",
          );
        }
      }
    }),
  logout: publicProcedure.mutation(async () => {
    try {
      cookies().set("8slpAutht", "", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: 0,
        path: "/",
      });
      return {
        success: true,
      };
    } catch (error) {
      console.error("Error during logout:", error);
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred during logout.",
      });
    }
  }),
  getAutomationSettings: publicProcedure.query(async ({ ctx }) => {
    const decoded = await checkAuthCookie(ctx.headers);
    const profile = await db.query.userTemperatureProfile.findFirst({
      where: eq(userTemperatureProfile.email, decoded.email),
    });
    let oneTimeOverride: OneTimeAutomationOverride | null = null;
    let temperatureSteps: Array<{ time: string; temperature: number }> = [];

    try {
      oneTimeOverride = await getOneTimeAutomationOverride(decoded.email);
      if (oneTimeOverride) {
        const currentLocalDate = formatLocalDate(
          localNow(oneTimeOverride.timezone),
        );
        if (
          oneTimeOverride.onLocalDate !== null &&
          oneTimeOverride.onLocalDate < currentLocalDate
        ) {
          await clearOneTimeOnOverride(decoded.email);
          oneTimeOverride.onTime = null;
          oneTimeOverride.onLocalDate = null;
        }
        if (
          oneTimeOverride.offLocalDate !== null &&
          oneTimeOverride.offLocalDate < currentLocalDate
        ) {
          await clearOneTimeOffOverride(decoded.email);
          oneTimeOverride.offTime = null;
          oneTimeOverride.offLocalDate = null;
          oneTimeOverride.delayMinutes = null;
        }
        if (
          oneTimeOverride.onTime === null &&
          oneTimeOverride.offTime === null
        ) {
          oneTimeOverride = null;
        }
      }
    } catch (error) {
      console.error("Failed to load one-time override:", error);
    }

    try {
      const savedSteps = await getTemperatureScheduleSteps(decoded.email);
      temperatureSteps = savedSteps.map((step) => ({
        time: step.time,
        temperature: Math.round(step.level / 10),
      }));
    } catch (error) {
      console.error("Failed to load temperature schedule:", error);
    }

    if (!profile) {
      return {
        offTime: "07:00",
        onTime: "21:00",
        timezone: "UTC",
        initialTemperature: 0,
        temperatureSteps,
        oneTimeOverride,
      };
    }

    return {
      offTime: profile.wakeupTime.slice(0, 5),
      onTime: profile.bedTime.slice(0, 5),
      timezone: profile.timezoneTZ,
      initialTemperature: Math.round(profile.initialSleepLevel / 10),
      temperatureSteps,
      oneTimeOverride,
    };
  }),
  updateAutomationSettings: publicProcedure
    .input(
      z.object({
        offTime: z.string().regex(/^\d{2}:\d{2}$/),
        onTime: z.string().regex(/^\d{2}:\d{2}$/),
        timezone: z.string().min(1).max(50),
        initialTemperature: z.number().int().min(-10).max(10),
        temperatureSteps: z
          .array(
            z.object({
              time: z.string().regex(/^\d{2}:\d{2}$/),
              temperature: z.number().int().min(-10).max(10),
            }),
          )
          .default([]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decoded = await checkAuthCookie(ctx.headers);
      const dbLevel = input.initialTemperature * 10;
      const temperatureSteps = input.temperatureSteps
        .map((step) => ({
          time: step.time,
          level: step.temperature * 10,
        }))
        .sort((a, b) => a.time.localeCompare(b.time));

      await db
        .insert(userTemperatureProfile)
        .values({
          email: decoded.email,
          bedTime: `${input.onTime}:00`,
          wakeupTime: `${input.offTime}:00`,
          timezoneTZ: input.timezone,
          initialSleepLevel: dbLevel,
          midStageSleepLevel: dbLevel,
          finalSleepLevel: dbLevel,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userTemperatureProfile.email,
          set: {
            bedTime: `${input.onTime}:00`,
            wakeupTime: `${input.offTime}:00`,
            timezoneTZ: input.timezone,
            initialSleepLevel: dbLevel,
            midStageSleepLevel: dbLevel,
            finalSleepLevel: dbLevel,
            updatedAt: new Date(),
          },
        })
        .execute();

      await replaceTemperatureScheduleSteps(decoded.email, temperatureSteps);

      return { success: true };
    }),
  setOneTimeOffDelay: publicProcedure
    .input(
      z.object({
        delayMinutes: z
          .number()
          .int()
          .min(15)
          .max(12 * 60),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decoded = await checkAuthCookie(ctx.headers);
      const profile = await db.query.userTemperatureProfile.findFirst({
        where: eq(userTemperatureProfile.email, decoded.email),
      });

      const offTime = profile?.wakeupTime.slice(0, 5) ?? "07:00";
      const timezone = profile?.timezoneTZ ?? "UTC";
      const now = localNow(timezone);
      const baseOffDate = nextLocalDateTime(now, offTime);
      const delayedOffDate = new Date(
        baseOffDate.getTime() + input.delayMinutes * 60 * 1000,
      );

      await setOneTimeOffOverride({
        email: decoded.email,
        offTime: formatLocalTime(delayedOffDate),
        offLocalDate: formatLocalDate(delayedOffDate),
        delayMinutes: input.delayMinutes,
        timezone,
      });

      return {
        success: true,
        oneTimeOverride: {
          onTime: null,
          onLocalDate: null,
          offTime: formatLocalTime(delayedOffDate),
          offLocalDate: formatLocalDate(delayedOffDate),
          delayMinutes: input.delayMinutes,
          timezone,
        },
      };
    }),
  setOneTimeOnTime: publicProcedure
    .input(
      z.object({
        onTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decoded = await checkAuthCookie(ctx.headers);
      const profile = await db.query.userTemperatureProfile.findFirst({
        where: eq(userTemperatureProfile.email, decoded.email),
      });
      const timezone = profile?.timezoneTZ ?? "UTC";
      const targetDate = nextLocalDateTime(localNow(timezone), input.onTime);

      await setOneTimeOnOverride({
        email: decoded.email,
        onTime: input.onTime,
        onLocalDate: formatLocalDate(targetDate),
        timezone,
      });

      return { success: true };
    }),
  setOneTimeOffTime: publicProcedure
    .input(
      z.object({
        offTime: z.string().regex(/^\d{2}:\d{2}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const decoded = await checkAuthCookie(ctx.headers);
      const profile = await db.query.userTemperatureProfile.findFirst({
        where: eq(userTemperatureProfile.email, decoded.email),
      });
      const timezone = profile?.timezoneTZ ?? "UTC";
      const targetDate = nextLocalDateTime(localNow(timezone), input.offTime);

      await setOneTimeOffOverride({
        email: decoded.email,
        offTime: input.offTime,
        offLocalDate: formatLocalDate(targetDate),
        delayMinutes: null,
        timezone,
      });

      return { success: true };
    }),
  clearOneTimeOnTime: publicProcedure.mutation(async ({ ctx }) => {
    const decoded = await checkAuthCookie(ctx.headers);
    await clearOneTimeOnOverride(decoded.email);
    return { success: true };
  }),
  clearOneTimeOffDelay: publicProcedure.mutation(async ({ ctx }) => {
    const decoded = await checkAuthCookie(ctx.headers);
    await clearOneTimeOffOverride(decoded.email);
    return { success: true };
  }),
  clearOneTimeAutomationOverride: publicProcedure.mutation(async ({ ctx }) => {
    const decoded = await checkAuthCookie(ctx.headers);
    await clearOneTimeAutomationOverride(decoded.email);
    return { success: true };
  }),
});

async function authenticateUser(email: string, password: string) {
  try {
    return await authenticate(email, password);
  } catch (error) {
    if (error instanceof AuthError) {
      throw error; // Propagate the AuthError with its specific message
    } else {
      throw new AuthError("Failed to authenticate user");
    }
  }
}

async function saveUserToDatabase(email: string, authResult: Token) {
  try {
    await db
      .insert(users)
      .values({
        email,
        eightAccessToken: authResult.eightAccessToken,
        eightRefreshToken: authResult.eightRefreshToken,
        eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
        eightUserId: authResult.eightUserId,
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          eightAccessToken: authResult.eightAccessToken,
          eightRefreshToken: authResult.eightRefreshToken,
          eightTokenExpiresAt: new Date(authResult.eightExpiresAtPosix),
          eightUserId: authResult.eightUserId,
        },
      })
      .execute();
  } catch (error) {
    console.error("Database operation failed:", error);
    throw new DatabaseError("Failed to save user token to database.");
  }
}
