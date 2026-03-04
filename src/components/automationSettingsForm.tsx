"use client";

import { useEffect, useState } from "react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";
import TimezoneSelect, {
  allTimezones,
  type ITimezoneOption,
} from "react-timezone-select";

type AutomationSettings = {
  offTime: string;
  onTime: string;
  timezone: string;
  initialTemperature: number;
};

const DEFAULT_SETTINGS: AutomationSettings = {
  offTime: "07:00",
  onTime: "21:00",
  timezone: "UTC",
  initialTemperature: 0,
};

export function AutomationSettingsForm() {
  const [settings, setSettings] = useState<AutomationSettings>(DEFAULT_SETTINGS);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const settingsQuery = apiR.user.getAutomationSettings.useQuery();
  const updateSettings = apiR.user.updateAutomationSettings.useMutation({
    onSuccess: () => {
      setSaveMessage("Settings saved.");
      void settingsQuery.refetch();
    },
    onError: (error) => {
      setSaveMessage(`Save failed: ${error.message}`);
    },
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSettings(settingsQuery.data);
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

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    updateSettings.mutate(settings);
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

        <label className="flex flex-col gap-1 text-sm">
          Initial Temperature Level (-10 to 10)
          <input
            type="number"
            min={-10}
            max={10}
            step={1}
            value={settings.initialTemperature}
            onChange={(event) =>
              updateField("initialTemperature", Number(event.target.value))
            }
            className="rounded border px-3 py-2"
            required
          />
        </label>
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
