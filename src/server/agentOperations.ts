import { eq } from "drizzle-orm";
import { db } from "~/server/db";
import { userTemperatureProfile } from "~/server/db/schema";
import {
  clearOneTimeAutomationOverride,
  getOneTimeAutomationOverride,
  setOneTimeOffOverride,
  setOneTimeOnOverride,
} from "~/server/automationOverrides";
import { getAwayPeriods } from "~/server/awayPeriods";
import {
  clearAwayForTarget,
  setDirectPower,
  setDirectTemperature,
  startAwayForTarget,
  startNapForTarget,
  stopNapForTarget,
} from "~/server/napControl";
import { getNapSessions } from "~/server/napSessions";
import {
  getTemperatureScheduleSteps,
  replaceTemperatureScheduleSteps,
} from "~/server/temperatureSchedule";

export async function getAgentState(targetEmail: string) {
  const profile = await db.query.userTemperatureProfile.findFirst({
    where: eq(userTemperatureProfile.email, targetEmail),
  });
  const [steps, override, naps, away] = await Promise.all([
    getTemperatureScheduleSteps(targetEmail),
    getOneTimeAutomationOverride(targetEmail),
    getNapSessions(),
    getAwayPeriods(),
  ]);
  return {
    targetEmail,
    schedule: {
      onTime: profile?.bedTime.slice(0, 5) ?? "21:00",
      offTime: profile?.wakeupTime.slice(0, 5) ?? "07:00",
      timezone: profile?.timezoneTZ ?? "UTC",
      initialTemperature: Math.round((profile?.initialSleepLevel ?? 0) / 10),
      temperatureSteps: steps.map((step) => ({
        time: step.time,
        temperature: Math.round(step.level / 10),
      })),
    },
    oneTimeOverride: override,
    nap: naps.find((nap) => nap.targetEmail === targetEmail)
      ? {
          temperature: Math.round(
            naps.find((nap) => nap.targetEmail === targetEmail)!.temperature /
              10,
          ),
          endsAt: naps
            .find((nap) => nap.targetEmail === targetEmail)!
            .endsAt.toISOString(),
        }
      : null,
    away: away.find((period) => period.targetEmail === targetEmail)
      ? {
          startsAt: away
            .find((period) => period.targetEmail === targetEmail)!
            .startsAt.toISOString(),
          endsAt: away
            .find((period) => period.targetEmail === targetEmail)!
            .endsAt.toISOString(),
        }
      : null,
  };
}

export async function updateAgentSchedule(
  targetEmail: string,
  input: {
    onTime: string;
    offTime: string;
    timezone: string;
    initialTemperature: number;
    temperatureSteps: Array<{ time: string; temperature: number }>;
  },
) {
  const level = input.initialTemperature * 10;
  await db
    .insert(userTemperatureProfile)
    .values({
      email: targetEmail,
      bedTime: `${input.onTime}:00`,
      wakeupTime: `${input.offTime}:00`,
      timezoneTZ: input.timezone,
      initialSleepLevel: level,
      midStageSleepLevel: level,
      finalSleepLevel: level,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: userTemperatureProfile.email,
      set: {
        bedTime: `${input.onTime}:00`,
        wakeupTime: `${input.offTime}:00`,
        timezoneTZ: input.timezone,
        initialSleepLevel: level,
        midStageSleepLevel: level,
        finalSleepLevel: level,
        updatedAt: new Date(),
      },
    });
  await replaceTemperatureScheduleSteps(
    targetEmail,
    input.temperatureSteps.map((step) => ({
      time: step.time,
      level: step.temperature * 10,
    })),
  );
}

export async function setAgentOneTime(
  targetEmail: string,
  input: {
    onTime?: string;
    offTime?: string;
    timezone: string;
    localDate: string;
  },
) {
  if (input.onTime) {
    await setOneTimeOnOverride({
      email: targetEmail,
      onTime: input.onTime,
      onLocalDate: input.localDate,
      timezone: input.timezone,
    });
  }
  if (input.offTime) {
    await setOneTimeOffOverride({
      email: targetEmail,
      offTime: input.offTime,
      offLocalDate: input.localDate,
      delayMinutes: null,
      timezone: input.timezone,
    });
  }
}

export {
  clearOneTimeAutomationOverride,
  clearAwayForTarget,
  setDirectPower,
  setDirectTemperature,
  startAwayForTarget,
  startNapForTarget,
  stopNapForTarget,
};
