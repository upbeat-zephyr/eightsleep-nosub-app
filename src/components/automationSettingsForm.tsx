"use client";

import { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import { Minus, Plus, X } from "lucide-react";
import TimezoneSelect, {
  allTimezones,
  type ITimezoneOption,
} from "react-timezone-select";

type AutomationSettings = {
  offTime: string;
  onTime: string;
  timezone: string;
  initialTemperature: number;
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
  oneTimeOverride: null,
};

const lightButtonClass =
  "border-gray-300 bg-white text-gray-950 shadow-sm hover:bg-gray-100 disabled:bg-gray-100 disabled:text-gray-500";
const iconButtonClass = `${lightButtonClass} h-11 w-11 shrink-0`;

function clampTemperature(value: number): number {
  return Math.min(10, Math.max(-10, value));
}

function formatDelay(minutes: number): string {
  if (minutes % 60 === 0) {
    return `+${minutes / 60}h`;
  }
  return `+${minutes}m`;
}

export function AutomationSettingsForm() {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [temperatureInput, setTemperatureInput] = useState(
    String(DEFAULT_SETTINGS.initialTemperature),
  );
  const [oneTimeOnInput, setOneTimeOnInput] = useState(DEFAULT_SETTINGS.onTime);
  const [oneTimeOffInput, setOneTimeOffInput] = useState(
    DEFAULT_SETTINGS.offTime,
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const settingsQuery = apiR.user.getAutomationSettings.useQuery();
  const updateSettings = apiR.user.updateAutomationSettings.useMutation({
    onSuccess: (_result, savedSettings) => {
      setSettings((prev) => ({
        ...savedSettings,
        oneTimeOverride: prev.oneTimeOverride,
      }));
      setTemperatureInput(String(savedSettings.initialTemperature));
      setSaveMessage("Settings saved.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Save failed: ${error.message}`);
    },
  });
  const setOneTimeDelay = apiR.user.setOneTimeOffDelay.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-off delay saved.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Delay failed: ${error.message}`);
    },
  });
  const setOneTimeOnTime = apiR.user.setOneTimeOnTime.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-on time saved.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Turn-on override failed: ${error.message}`);
    },
  });
  const setOneTimeOffTime = apiR.user.setOneTimeOffTime.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-off time saved.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Turn-off override failed: ${error.message}`);
    },
  });
  const clearOneTimeOnTime = apiR.user.clearOneTimeOnTime.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-on cleared.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Clear failed: ${error.message}`);
    },
  });
  const clearOneTimeOffTime = apiR.user.clearOneTimeOffDelay.useMutation({
    onSuccess: () => {
      setSaveMessage("One-time turn-off cleared.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Clear failed: ${error.message}`);
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
      setTemperatureInput(String(settingsQuery.data.initialTemperature));
      setOneTimeOnInput(
        settingsQuery.data.oneTimeOverride?.onTime ?? settingsQuery.data.onTime,
      );
      setOneTimeOffInput(
        settingsQuery.data.oneTimeOverride?.offTime ??
          settingsQuery.data.offTime,
      );
    }
  }, [settingsQuery.data]);

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

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedTemperature = Number(temperatureInput);

    if (
      !Number.isInteger(parsedTemperature) ||
      parsedTemperature < -10 ||
      parsedTemperature > 10
    ) {
      setSaveMessage("Temperature must be a whole number from -10 to 10.");
      return;
    }

    const { oneTimeOverride: _oneTimeOverride, ...savedSettings } = settings;

    updateSettings.mutate({
      ...savedSettings,
      initialTemperature: parsedTemperature,
    });
  }

  if (settingsQuery.isLoading) {
    return <div className="text-sm text-white/80">Loading settings...</div>;
  }

  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto mt-4 w-full max-w-xl rounded-lg bg-white p-6 text-gray-900 shadow-xl"
    >
      <h2 className="mb-4 text-xl font-bold">Automation Settings</h2>
      <div className="grid gap-4">
        <label className="flex flex-col gap-1 text-sm">
          Turn Off Time
          <input
            type="time"
            value={settings.offTime}
            onChange={(event) => updateField("offTime", event.target.value)}
            className="rounded border px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Turn On Time
          <input
            type="time"
            value={settings.onTime}
            onChange={(event) => updateField("onTime", event.target.value)}
            className="rounded border px-3 py-2"
            required
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Timezone
          <TimezoneSelect
            value={settings.timezone}
            onChange={(tz: ITimezoneOption) => updateField("timezone", tz.value)}
            timezones={{
              ...allTimezones,
              "America/New_York": "America/New York",
              "America/Los_Angeles": "America/Los Angeles",
            }}
            className="text-sm"
          />
        </label>

        <div className="flex flex-col gap-1 text-sm">
          Initial Temperature Level (-10 to 10)
          <div className="flex items-center gap-2">
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
              onChange={(event) => updateTemperatureInput(event.target.value)}
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

        <div className="border-t pt-4">
          <div className="mb-3 text-sm font-medium">One-Time Times</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Next Turn On
              <div className="flex gap-2">
                <input
                  type="time"
                  value={oneTimeOnInput}
                  onChange={(event) => {
                    setOneTimeOnInput(event.target.value);
                    setSaveMessage(null);
                  }}
                  className="min-w-0 flex-1 rounded border px-3 py-2"
                />
                <Button
                  type="button"
                  variant="outline"
                  className={lightButtonClass}
                  onClick={() =>
                    setOneTimeOnTime.mutate({ onTime: oneTimeOnInput })
                  }
                  disabled={setOneTimeOnTime.isPending}
                >
                  Use once
                </Button>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Next Turn Off
              <div className="flex gap-2">
                <input
                  type="time"
                  value={oneTimeOffInput}
                  onChange={(event) => {
                    setOneTimeOffInput(event.target.value);
                    setSaveMessage(null);
                  }}
                  className="min-w-0 flex-1 rounded border px-3 py-2"
                />
                <Button
                  type="button"
                  variant="outline"
                  className={lightButtonClass}
                  onClick={() =>
                    setOneTimeOffTime.mutate({ offTime: oneTimeOffInput })
                  }
                  disabled={setOneTimeOffTime.isPending}
                >
                  Use once
                </Button>
              </div>
            </label>
          </div>

          {settings.oneTimeOverride && (
            <div className="mt-3 grid gap-2 text-sm">
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
                      onClick={() => clearOneTimeOnTime.mutate()}
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
                      onClick={() => clearOneTimeOffTime.mutate()}
                      disabled={clearOneTimeOffTime.isPending}
                    >
                      <X className="mr-1 h-4 w-4" />
                      Clear
                    </Button>
                  </div>
                )}
            </div>
          )}
        </div>

        <div className="border-t pt-4">
          <div className="mb-2 text-sm font-medium">Delay Next Turn Off</div>
          <div className="flex flex-wrap gap-2">
            {[30, 60, 120, 180].map((minutes) => (
              <Button
                key={minutes}
                type="button"
                variant="outline"
                className={lightButtonClass}
                onClick={() => setOneTimeDelay.mutate({ delayMinutes: minutes })}
                disabled={setOneTimeDelay.isPending}
              >
                {formatDelay(minutes)}
              </Button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" disabled={updateSettings.isPending}>
          {updateSettings.isPending ? "Saving..." : "Save settings"}
        </Button>
        {saveMessage && <p className="text-sm">{saveMessage}</p>}
      </div>
    </form>
  );
}
