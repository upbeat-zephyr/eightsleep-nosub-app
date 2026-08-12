"use client";

import { useEffect, useRef, useState } from "react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import {
  CalendarClock,
  Clock3,
  Minus,
  Moon,
  Plus,
  TimerReset,
  X,
} from "lucide-react";
import TimezoneSelect, {
  allTimezones,
  type ITimezoneOption,
} from "react-timezone-select";

type TemperatureStep = {
  time: string;
  temperature: number;
};

type TemperatureStepInput = {
  id: string;
  time: string;
  temperatureInput: string;
};

type AutomationSettings = {
  offTime: string;
  onTime: string;
  timezone: string;
  initialTemperature: number;
  temperatureSteps: TemperatureStep[];
  oneTimeOverride: {
    onTime: string | null;
    onLocalDate: string | null;
    offTime: string | null;
    offLocalDate: string | null;
    delayMinutes: number | null;
    timezone: string;
  } | null;
};

const DEFAULT_SETTINGS: AutomationSettings = {
  offTime: "07:00",
  onTime: "21:00",
  timezone: "UTC",
  initialTemperature: 0,
  temperatureSteps: [],
  oneTimeOverride: null,
};

const lightButtonClass =
  "border-gray-300 bg-white text-gray-950 shadow-sm hover:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-500";
const iconButtonClass = `${lightButtonClass} h-11 w-11 shrink-0`;
const compactIconButtonClass = `${lightButtonClass} h-9 w-9 shrink-0`;

function clampTemperature(value: number): number {
  return Math.min(10, Math.max(-10, value));
}

function formatDelay(minutes: number): string {
  if (minutes % 60 === 0) {
    return `+${minutes / 60}h`;
  }
  return `+${minutes}m`;
}

function createTemperatureStepInput(
  step: TemperatureStep,
  index: number,
): TemperatureStepInput {
  return {
    id: `temperature-step-${index}-${step.time}-${step.temperature}`,
    time: step.time,
    temperatureInput: String(step.temperature),
  };
}

function buildSettingsPayload(
  settings: AutomationSettings,
  temperatureInput: string,
  temperatureStepInputs: TemperatureStepInput[],
  targetEmail: string,
) {
  const initialTemperature = Number(temperatureInput);
  if (
    !/^\d{2}:\d{2}$/.test(settings.onTime) ||
    !/^\d{2}:\d{2}$/.test(settings.offTime) ||
    !Number.isInteger(initialTemperature) ||
    initialTemperature < -10 ||
    initialTemperature > 10
  ) {
    return null;
  }

  const temperatureSteps: TemperatureStep[] = [];
  for (const step of temperatureStepInputs) {
    const temperature = Number(step.temperatureInput);
    if (
      !/^\d{2}:\d{2}$/.test(step.time) ||
      !Number.isInteger(temperature) ||
      temperature < -10 ||
      temperature > 10
    ) {
      return null;
    }
    temperatureSteps.push({ time: step.time, temperature });
  }
  temperatureSteps.sort((a, b) => a.time.localeCompare(b.time));

  return {
    offTime: settings.offTime,
    onTime: settings.onTime,
    timezone: settings.timezone,
    initialTemperature,
    temperatureSteps,
    targetEmail,
  };
}

export function AutomationSettingsForm({
  targetEmail,
  mode = "automation",
}: {
  targetEmail: string;
  mode?: "automation" | "once";
}) {
  const [settings, setSettings] =
    useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [temperatureInput, setTemperatureInput] = useState(
    String(DEFAULT_SETTINGS.initialTemperature),
  );
  const [oneTimeOnInput, setOneTimeOnInput] = useState(DEFAULT_SETTINGS.onTime);
  const [oneTimeOffInput, setOneTimeOffInput] = useState(
    DEFAULT_SETTINGS.offTime,
  );
  const [temperatureStepInputs, setTemperatureStepInputs] = useState<
    TemperatureStepInput[]
  >([]);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const hydratedRef = useRef(false);
  const lastSavedRef = useRef("");
  const latestSaveRef = useRef("");
  const saveChainRef = useRef(Promise.resolve());
  const lastOneTimeOnRef = useRef("");
  const lastOneTimeOffRef = useRef("");

  const settingsQuery = apiR.user.getAutomationSettings.useQuery({
    targetEmail,
  });
  const updateSettings = apiR.user.updateAutomationSettings.useMutation();
  const setOneTimeDelay = apiR.user.setOneTimeOffDelay.useMutation({
    onSuccess: (result) => {
      setSettings((prev) => ({
        ...prev,
        oneTimeOverride: result.oneTimeOverride,
      }));
      setSaveMessage("One-time turn-off delay saved.");
    },
    onError: (error) => {
      setSaveMessage(`Delay failed: ${error.message}`);
    },
  });
  const setOneTimeOnTime = apiR.user.setOneTimeOnTime.useMutation({
    onSuccess: (result) => {
      setSettings((prev) => ({
        ...prev,
        oneTimeOverride: {
          onTime: result.onTime,
          onLocalDate: result.onLocalDate,
          offTime: prev.oneTimeOverride?.offTime ?? null,
          offLocalDate: prev.oneTimeOverride?.offLocalDate ?? null,
          delayMinutes: prev.oneTimeOverride?.delayMinutes ?? null,
          timezone: result.timezone,
        },
      }));
      setSaveMessage("One-time turn-on time saved.");
    },
    onError: (error) => {
      setSaveMessage(`Turn-on override failed: ${error.message}`);
    },
  });
  const setOneTimeOffTime = apiR.user.setOneTimeOffTime.useMutation({
    onSuccess: (result) => {
      setSettings((prev) => ({
        ...prev,
        oneTimeOverride: {
          onTime: prev.oneTimeOverride?.onTime ?? null,
          onLocalDate: prev.oneTimeOverride?.onLocalDate ?? null,
          offTime: result.offTime,
          offLocalDate: result.offLocalDate,
          delayMinutes: null,
          timezone: result.timezone,
        },
      }));
      setSaveMessage("One-time turn-off time saved.");
    },
    onError: (error) => {
      setSaveMessage(`Turn-off override failed: ${error.message}`);
    },
  });
  const clearOneTimeOnTime = apiR.user.clearOneTimeOnTime.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-on cleared.");
    },
    onError: (error) => {
      setSaveMessage(`Clear failed: ${error.message}`);
    },
  });
  const clearOneTimeOffTime = apiR.user.clearOneTimeOffDelay.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-off cleared.");
    },
    onError: (error) => {
      setSaveMessage(`Clear failed: ${error.message}`);
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
      setTemperatureInput(String(settingsQuery.data.initialTemperature));
      setTemperatureStepInputs(
        settingsQuery.data.temperatureSteps.map(createTemperatureStepInput),
      );
      setOneTimeOnInput(
        settingsQuery.data.oneTimeOverride?.onTime ?? settingsQuery.data.onTime,
      );
      setOneTimeOffInput(
        settingsQuery.data.oneTimeOverride?.offTime ??
          settingsQuery.data.offTime,
      );
      lastOneTimeOnRef.current =
        settingsQuery.data.oneTimeOverride?.onTime ?? "";
      lastOneTimeOffRef.current =
        settingsQuery.data.oneTimeOverride?.offTime ?? "";
      const initialPayload = buildSettingsPayload(
        settingsQuery.data,
        String(settingsQuery.data.initialTemperature),
        settingsQuery.data.temperatureSteps.map(createTemperatureStepInput),
        targetEmail,
      );
      lastSavedRef.current = initialPayload
        ? JSON.stringify(initialPayload)
        : "";
      hydratedRef.current = true;
    }
  }, [settingsQuery.data, targetEmail]);

  useEffect(() => {
    if (!hydratedRef.current || mode !== "automation") return;
    const payload = buildSettingsPayload(
      settings,
      temperatureInput,
      temperatureStepInputs,
      targetEmail,
    );
    if (!payload) return;
    const serialized = JSON.stringify(payload);
    latestSaveRef.current = serialized;
    if (serialized === lastSavedRef.current) return;

    const timer = window.setTimeout(() => {
      saveChainRef.current = saveChainRef.current
        .catch(() => undefined)
        .then(async () => {
          if (serialized === lastSavedRef.current) return;
          setSaveMessage("Saving…");
          try {
            await updateSettings.mutateAsync(payload);
            lastSavedRef.current = serialized;
            if (latestSaveRef.current === serialized) {
              setSaveMessage("Settings saved.");
            }
          } catch (error) {
            if (latestSaveRef.current === serialized) {
              setSaveMessage(
                `Save failed: ${error instanceof Error ? error.message : "Unknown error"}`,
              );
            }
          }
        });
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    mode,
    settings,
    targetEmail,
    temperatureInput,
    temperatureStepInputs,
    updateSettings,
  ]);

  function updateField<K extends keyof AutomationSettings>(
    key: K,
    value: AutomationSettings[K],
  ) {
    setSettings((prev) => ({
      ...prev,
      [key]: value,
    }));
    setSaveMessage(null);
  }

  function updateTemperatureInput(value: string) {
    if (!/^-?\d*$/.test(value)) {
      return;
    }

    setTemperatureInput(value);
    setSaveMessage(null);

    if (value === "" || value === "-") {
      return;
    }

    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed >= -10 && parsed <= 10) {
      updateField("initialTemperature", parsed);
    }
  }

  function adjustTemperature(delta: number) {
    const parsed = Number(temperatureInput);
    const current = Number.isInteger(parsed)
      ? parsed
      : settings.initialTemperature;
    const next = clampTemperature(current + delta);
    setTemperatureInput(String(next));
    updateField("initialTemperature", next);
  }

  function addTemperatureStep() {
    setTemperatureStepInputs((prev) => [
      ...prev,
      {
        id: `temperature-step-new-${Date.now()}-${prev.length}`,
        time: prev.at(-1)?.time ?? "02:00",
        temperatureInput: String(settings.initialTemperature),
      },
    ]);
    setSaveMessage(null);
  }

  function updateTemperatureStepTime(id: string, time: string) {
    setTemperatureStepInputs((prev) =>
      prev.map((step) => (step.id === id ? { ...step, time } : step)),
    );
    setSaveMessage(null);
  }

  function updateTemperatureStepTemperature(id: string, value: string) {
    if (!/^-?\d*$/.test(value)) {
      return;
    }

    setTemperatureStepInputs((prev) =>
      prev.map((step) =>
        step.id === id ? { ...step, temperatureInput: value } : step,
      ),
    );
    setSaveMessage(null);
  }

  function adjustTemperatureStep(id: string, delta: number) {
    setTemperatureStepInputs((prev) =>
      prev.map((step) => {
        if (step.id !== id) {
          return step;
        }

        const parsed = Number(step.temperatureInput);
        const current = Number.isInteger(parsed)
          ? parsed
          : settings.initialTemperature;
        return {
          ...step,
          temperatureInput: String(clampTemperature(current + delta)),
        };
      }),
    );
    setSaveMessage(null);
  }

  function removeTemperatureStep(id: string) {
    setTemperatureStepInputs((prev) => prev.filter((step) => step.id !== id));
    setSaveMessage(null);
  }

  function saveOneTimeOn(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value) || value === lastOneTimeOnRef.current) {
      return;
    }
    lastOneTimeOnRef.current = value;
    setSaveMessage("Saving…");
    setOneTimeOnTime.mutate({ onTime: value, targetEmail });
  }

  function saveOneTimeOff(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value) || value === lastOneTimeOffRef.current) {
      return;
    }
    lastOneTimeOffRef.current = value;
    setSaveMessage("Saving…");
    setOneTimeOffTime.mutate({ offTime: value, targetEmail });
  }

  function clearOnTime() {
    const previous = settings.oneTimeOverride;
    setSettings((current) => {
      if (!current.oneTimeOverride) return current;
      const next = {
        ...current.oneTimeOverride,
        onTime: null,
        onLocalDate: null,
      };
      return {
        ...current,
        oneTimeOverride: next.offTime ? next : null,
      };
    });
    lastOneTimeOnRef.current = "";
    setSaveMessage("Clearing…");
    clearOneTimeOnTime.mutate(
      { targetEmail },
      {
        onError: () => {
          setSettings((current) => ({
            ...current,
            oneTimeOverride: previous,
          }));
          lastOneTimeOnRef.current = previous?.onTime ?? "";
        },
      },
    );
  }

  function clearOffTime() {
    const previous = settings.oneTimeOverride;
    setSettings((current) => {
      if (!current.oneTimeOverride) return current;
      const next = {
        ...current.oneTimeOverride,
        offTime: null,
        offLocalDate: null,
        delayMinutes: null,
      };
      return {
        ...current,
        oneTimeOverride: next.onTime ? next : null,
      };
    });
    lastOneTimeOffRef.current = "";
    setSaveMessage("Clearing…");
    clearOneTimeOffTime.mutate(
      { targetEmail },
      {
        onError: () => {
          setSettings((current) => ({
            ...current,
            oneTimeOverride: previous,
          }));
          lastOneTimeOffRef.current = previous?.offTime ?? "";
        },
      },
    );
  }

  if (settingsQuery.isLoading) {
    return <div className="text-sm text-white/80">Loading settings...</div>;
  }

  return (
    <div className="mx-auto w-full min-w-0 max-w-xl rounded-3xl bg-white p-4 text-slate-900 shadow-2xl shadow-black/20 ring-1 ring-white/20 sm:mt-4 sm:p-6">
      <h1 className="mb-5 flex items-center gap-3 text-2xl font-bold tracking-tight">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-100 text-[#2e026d]">
          {mode === "automation" ? (
            <CalendarClock className="h-5 w-5" aria-hidden="true" />
          ) : (
            <Clock3 className="h-5 w-5" aria-hidden="true" />
          )}
        </span>
        {mode === "automation" ? "Automation" : "Once"}
      </h1>
      <div className="grid gap-4">
        {mode === "automation" && (
          <>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                Turn On
                <input
                  type="time"
                  value={settings.onTime}
                  onChange={(event) =>
                    updateField("onTime", event.target.value)
                  }
                  className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3"
                  required
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                Turn Off
                <input
                  type="time"
                  value={settings.offTime}
                  onChange={(event) =>
                    updateField("offTime", event.target.value)
                  }
                  className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3"
                  required
                />
              </label>
            </div>

            <TimezoneSelect
              value={settings.timezone}
              onChange={(tz: ITimezoneOption) =>
                updateField("timezone", tz.value)
              }
              timezones={{
                ...allTimezones,
                "America/New_York": "America/New York",
                "America/Los_Angeles": "America/Los Angeles",
              }}
              aria-label="Timezone"
              className="min-w-0 max-w-full text-sm"
              styles={{
                control: (base) => ({
                  ...base,
                  minHeight: "auto",
                  border: 0,
                  boxShadow: "none",
                  background: "transparent",
                  cursor: "pointer",
                }),
                valueContainer: (base) => ({ ...base, padding: 0 }),
                singleValue: (base) => ({
                  ...base,
                  color: "#6d28d9",
                  textDecoration: "underline",
                  textUnderlineOffset: "3px",
                }),
                indicatorsContainer: (base) => ({
                  ...base,
                  transform: "scale(.8)",
                }),
              }}
            />

            <div className="flex flex-col gap-1 text-sm">
              Initial Temperature Level (-10 to 10)
              <div className="grid min-w-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={iconButtonClass}
                  onClick={() => adjustTemperature(-1)}
                  aria-label="Decrease initial temperature"
                >
                  <Minus className="h-4 w-4" />
                </Button>
                <input
                  type="text"
                  inputMode="numeric"
                  value={temperatureInput}
                  onChange={(event) =>
                    updateTemperatureInput(event.target.value)
                  }
                  onBlur={() => {
                    if (temperatureInput === "" || temperatureInput === "-") {
                      setTemperatureInput(String(settings.initialTemperature));
                    }
                  }}
                  className="min-w-0 flex-1 rounded border px-3 py-2 text-center"
                  required
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={iconButtonClass}
                  onClick={() => adjustTemperature(1)}
                  aria-label="Increase initial temperature"
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Moon
                    className="h-4 w-4 text-violet-700"
                    aria-hidden="true"
                  />
                  Night Temperature Changes
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={lightButtonClass}
                  onClick={addTemperatureStep}
                >
                  <Plus className="mr-1 h-4 w-4" />
                  Add
                </Button>
              </div>
              {temperatureStepInputs.length > 0 && (
                <div className="grid gap-2">
                  {temperatureStepInputs.map((step) => (
                    <div
                      key={step.id}
                      className="grid min-w-0 grid-cols-[2.25rem_minmax(3.5rem,1fr)_2.25rem_2.25rem] items-center gap-1.5 sm:grid-cols-[minmax(6.5rem,1fr)_2.25rem_minmax(3.5rem,4rem)_2.25rem_2.25rem] sm:gap-2"
                    >
                      <input
                        type="time"
                        value={step.time}
                        onChange={(event) =>
                          updateTemperatureStepTime(step.id, event.target.value)
                        }
                        className="col-span-4 h-9 min-w-0 rounded border px-2 text-sm sm:col-span-1"
                        aria-label="Temperature change time"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={compactIconButtonClass}
                        onClick={() => adjustTemperatureStep(step.id, -1)}
                        aria-label="Decrease scheduled temperature"
                      >
                        <Minus className="h-4 w-4" />
                      </Button>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={step.temperatureInput}
                        onChange={(event) =>
                          updateTemperatureStepTemperature(
                            step.id,
                            event.target.value,
                          )
                        }
                        onBlur={() => {
                          if (
                            step.temperatureInput === "" ||
                            step.temperatureInput === "-"
                          ) {
                            updateTemperatureStepTemperature(
                              step.id,
                              String(settings.initialTemperature),
                            );
                          }
                        }}
                        className="h-9 min-w-0 rounded border px-2 text-center text-sm"
                        aria-label="Temperature change level"
                        required
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={compactIconButtonClass}
                        onClick={() => adjustTemperatureStep(step.id, 1)}
                        aria-label="Increase scheduled temperature"
                      >
                        <Plus className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className={compactIconButtonClass}
                        onClick={() => removeTemperatureStep(step.id)}
                        aria-label="Remove temperature change"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {mode === "once" && (
          <>
            <div className="grid min-w-0 grid-cols-2 gap-3">
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                Next Turn On
                <input
                  type="time"
                  value={oneTimeOnInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOneTimeOnInput(value);
                    saveOneTimeOn(value);
                  }}
                  onBlur={() => saveOneTimeOn(oneTimeOnInput)}
                  className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3"
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-sm font-medium">
                Next Turn Off
                <input
                  type="time"
                  value={oneTimeOffInput}
                  onChange={(event) => {
                    const value = event.target.value;
                    setOneTimeOffInput(value);
                    saveOneTimeOff(value);
                  }}
                  onBlur={() => saveOneTimeOff(oneTimeOffInput)}
                  className="h-11 w-full min-w-0 rounded-xl border border-slate-300 px-3"
                />
              </label>
            </div>

            {settings.oneTimeOverride && (
              <div className="grid gap-2 text-sm">
                {settings.oneTimeOverride.onTime &&
                  settings.oneTimeOverride.onLocalDate && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Next turn-on:{" "}
                        <strong>{settings.oneTimeOverride.onTime}</strong> on{" "}
                        {settings.oneTimeOverride.onLocalDate}.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearOnTime}
                        disabled={clearOneTimeOnTime.isPending}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Clear
                      </Button>
                    </div>
                  )}
                {settings.oneTimeOverride.offTime &&
                  settings.oneTimeOverride.offLocalDate && (
                    <div className="flex flex-wrap items-center gap-2">
                      <span>
                        Next turn-off:{" "}
                        <strong>{settings.oneTimeOverride.offTime}</strong> on{" "}
                        {settings.oneTimeOverride.offLocalDate}.
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={clearOffTime}
                        disabled={clearOneTimeOffTime.isPending}
                      >
                        <X className="mr-1 h-4 w-4" />
                        Clear
                      </Button>
                    </div>
                  )}
              </div>
            )}

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <TimerReset
                  className="h-4 w-4 text-violet-700"
                  aria-hidden="true"
                />
                Delay Next Turn Off
              </div>
              <div className="grid grid-cols-4 gap-2">
                {[30, 60, 120, 180].map((minutes) => (
                  <Button
                    key={minutes}
                    type="button"
                    variant="outline"
                    className={`${lightButtonClass} min-w-0 px-1.5 sm:px-4`}
                    onClick={() =>
                      setOneTimeDelay.mutate({
                        delayMinutes: minutes,
                        targetEmail,
                      })
                    }
                    disabled={setOneTimeDelay.isPending}
                  >
                    {formatDelay(minutes)}
                  </Button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {saveMessage && <p className="mt-4 text-sm">{saveMessage}</p>}
    </div>
  );
}
