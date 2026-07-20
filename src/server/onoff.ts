import fs from "fs";
import path from "path";
import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { userTemperatureProfile, users } from "~/server/db/schema";
import { obtainFreshAccessToken } from "./eight/auth";
import { setHeatingLevel, turnOffSide, turnOnSide } from "./eight/eight";
import { type Token } from "./eight/types";
import {
  clearOneTimeOffOverride,
  getOneTimeOffOverride,
} from "./automationOverrides";

export type OnOffConfig = {
  off_time: string;
  on_time: string;
  timezone?: string;
  initial_level?: number;
};

const DEFAULT_CONFIG: OnOffConfig = {
  off_time: "07:00",
  on_time: "21:00",
  timezone: "UTC",
  initial_level: 0,
};
const DEFAULT_TOLERANCE_MINUTES = 15;
const API_RETRY_ATTEMPTS = 3;

function configPath(): string {
  return (
    process.env.ONOFF_CONFIG_PATH ??
    path.join(process.cwd(), "config", "onoff-config.json")
  );
}

export function loadOnOffConfig(): OnOffConfig {
  try {
    const raw = fs.readFileSync(configPath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<OnOffConfig>;
    const merged = {
      ...DEFAULT_CONFIG,
      ...parsed,
    };
    validateTime(merged.off_time);
    validateTime(merged.on_time);
    return merged;
  } catch (error) {
    console.warn("Falling back to default on/off config:", error);
    return DEFAULT_CONFIG;
  }
}

function validateTime(time: string) {
  if (!/^\d{2}:\d{2}$/.test(time)) {
    throw new Error(`Invalid time format (expected HH:MM): ${time}`);
  }
}

function timeToDate(now: Date, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number);
  if (
    hours === undefined ||
    minutes === undefined ||
    Number.isNaN(hours) ||
    Number.isNaN(minutes)
  ) {
    throw new Error(`Invalid time: ${time}`);
  }
  const copy = new Date(now);
  copy.setHours(hours, minutes, 0, 0);
  return copy;
}

function localNow(config: OnOffConfig, base: Date): Date {
  return new Date(
    base.toLocaleString("en-US", { timeZone: config.timezone ?? "UTC" }),
  );
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function withFreshToken(userEmail: string, token: Token): Promise<Token> {
  if (Date.now() <= token.eightExpiresAtPosix) {
    return token;
  }
  const refreshed = await obtainFreshAccessToken(
    token.eightRefreshToken,
    token.eightUserId,
  );
  await db
    .update(users)
    .set({
      eightAccessToken: refreshed.eightAccessToken,
      eightRefreshToken: refreshed.eightRefreshToken,
      eightTokenExpiresAt: new Date(refreshed.eightExpiresAtPosix),
    })
    .where(eq(users.email, userEmail))
    .execute();
  return refreshed;
}

async function retryApiCall<T>(
  apiCall: () => Promise<T>,
  retries = API_RETRY_ATTEMPTS,
): Promise<T> {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      return await apiCall();
    } catch (error) {
      if (attempt === retries - 1) {
        throw error;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, 500 * Math.pow(2, attempt)),
      );
    }
  }
  throw new Error("retryApiCall reached an impossible state");
}

export async function runOnOffJob(options?: {
  action?: "on" | "off";
  now?: Date;
  toleranceMinutes?: number;
}): Promise<{
  ranFor: number;
  onCount: number;
  offCount: number;
  skippedCount: number;
}> {
  const fallbackConfig = loadOnOffConfig();
  const toleranceMs =
    (options?.toleranceMinutes ?? DEFAULT_TOLERANCE_MINUTES) * 60 * 1000;
  const allUsers = await db
    .select({
      user: users,
      profile: userTemperatureProfile,
    })
    .from(users)
    .leftJoin(userTemperatureProfile, eq(users.email, userTemperatureProfile.email));

  let ranFor = 0;
  let onCount = 0;
  let offCount = 0;
  let skippedCount = 0;

  for (const entry of allUsers) {
    try {
      const { user, profile } = entry;
      const override = await getOneTimeOffOverride(user.email);
      const userConfig = {
        off_time: profile?.wakeupTime.slice(0, 5) ?? fallbackConfig.off_time,
        on_time: profile?.bedTime.slice(0, 5) ?? fallbackConfig.on_time,
        timezone: profile?.timezoneTZ ?? fallbackConfig.timezone ?? "UTC",
        initial_level: profile?.initialSleepLevel ?? fallbackConfig.initial_level ?? 0,
      };
      const current = localNow(userConfig, options?.now ?? new Date());
      const currentLocalDate = formatLocalDate(current);
      let usingOneTimeOffOverride = false;

      if (override && override.localDate < currentLocalDate) {
        await clearOneTimeOffOverride(user.email);
      } else if (override?.localDate === currentLocalDate) {
        userConfig.off_time = override.offTime;
        usingOneTimeOffOverride = true;
      }

      const targetOff = timeToDate(current, userConfig.off_time);
      const targetOn = timeToDate(current, userConfig.on_time);

      let action = options?.action ?? null;
      if (!action) {
        if (Math.abs(current.getTime() - targetOff.getTime()) <= toleranceMs) {
          action = "off";
        } else if (Math.abs(current.getTime() - targetOn.getTime()) <= toleranceMs) {
          action = "on";
        }
      }

      if (!action) {
        skippedCount += 1;
        continue;
      }

      const token: Token = {
        eightAccessToken: user.eightAccessToken,
        eightRefreshToken: user.eightRefreshToken,
        eightExpiresAtPosix: user.eightTokenExpiresAt.getTime(),
        eightUserId: user.eightUserId,
      };
      const fresh = await withFreshToken(user.email, token);
      if (action === "off") {
        await retryApiCall(() => turnOffSide(fresh, user.eightUserId));
        if (usingOneTimeOffOverride) {
          await clearOneTimeOffOverride(user.email);
        }
        offCount += 1;
      } else {
        await retryApiCall(() => turnOnSide(fresh, user.eightUserId));
        await retryApiCall(() =>
          setHeatingLevel(fresh, user.eightUserId, userConfig.initial_level),
        );
        onCount += 1;
      }
      ranFor += 1;
    } catch (error) {
      console.error("Failed to run on/off for user:", error);
    }
  }

  return { ranFor, onCount, offCount, skippedCount };
}
