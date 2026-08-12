"use client";

import { useEffect, useState } from "react";
import { Bed, Clock3, Minus, Plus, Power } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";

type HouseholdMember = {
  email: string;
  label: string;
  isSelf: boolean;
};

const durationOptions = [30, 60] as const;

function formatRemaining(endsAt: string, now: number): string {
  const minutes = Math.max(
    0,
    Math.ceil((new Date(endsAt).getTime() - now) / 60000),
  );
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m left` : `${hours}h left`;
}

export function NapPanel({ members }: { members: HouseholdMember[] }) {
  const utils = apiR.useUtils();
  const dashboard = apiR.nap.dashboard.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [target, setTarget] = useState("");
  const [duration, setDuration] = useState<number | "custom">(30);
  const [customDuration, setCustomDuration] = useState("90");
  const [temperature, setTemperature] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const self = members.find((member) => member.isSelf) ?? members[0];
    if (!target && self) setTarget(self.email);
  }, [members, target]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const startNap = apiR.nap.start.useMutation({
    onSuccess: (result) => {
      setMessage(
        result.failed.length
          ? "Nap started on one side, but the other side could not be reached."
          : "Nap started. Your side will turn off automatically.",
      );
      void utils.nap.dashboard.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });
  const stopNap = apiR.nap.stop.useMutation({
    onSuccess: () => {
      setMessage("Nap ended and the selected side is off.");
      void utils.nap.dashboard.invalidate();
    },
    onError: (error) => setMessage(error.message),
  });

  const resolvedDuration =
    duration === "custom" ? Number(customDuration) : duration;
  const targetEmails =
    target === "both" ? members.map((member) => member.email) : [target];
  const canStart =
    targetEmails.every(Boolean) &&
    Number.isInteger(resolvedDuration) &&
    resolvedDuration >= 15 &&
    resolvedDuration <= 480;

  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      {dashboard.data?.sessions.map((session) => {
        const member = members.find(
          (candidate) => candidate.email === session.targetEmail,
        );
        return (
          <div
            key={session.targetEmail}
            className="flex min-w-0 items-center gap-3 rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4 text-white shadow-lg backdrop-blur"
          >
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-300 text-emerald-950">
              <Power className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{member?.label ?? "Nap"} is on</p>
              <p className="text-sm text-white/70">
                Level {session.temperature > 0 ? "+" : ""}
                {session.temperature} · {formatRemaining(session.endsAt, now)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={stopNap.isPending}
              onClick={() =>
                stopNap.mutate({ targetEmails: [session.targetEmail] })
              }
            >
              End
            </Button>
          </div>
        );
      })}

      <div
        className={`grid gap-1 rounded-xl border border-white/10 bg-white/10 p-1 backdrop-blur ${
          members.length > 1 ? "grid-cols-3" : "grid-cols-1"
        }`}
      >
        {members.map((member) => (
          <button
            key={member.email}
            type="button"
            onClick={() => setTarget(member.email)}
            className={`min-h-10 whitespace-nowrap rounded-lg px-1.5 text-xs font-semibold transition sm:px-3 sm:text-sm ${
              target === member.email
                ? "bg-white text-[#2e026d] shadow"
                : "text-white/70 hover:text-white"
            }`}
          >
            {member.label}
          </button>
        ))}
        {members.length > 1 && (
          <button
            type="button"
            onClick={() => setTarget("both")}
            className={`min-h-10 whitespace-nowrap rounded-lg px-1.5 text-xs font-semibold transition sm:px-3 sm:text-sm ${
              target === "both"
                ? "bg-white text-[#2e026d] shadow"
                : "text-white/70 hover:text-white"
            }`}
          >
            Both sides
          </button>
        )}
      </div>

      <section className="overflow-hidden rounded-3xl bg-white text-slate-950 shadow-2xl shadow-black/20 ring-1 ring-white/20">
        <div className="bg-gradient-to-br from-violet-100 via-white to-fuchsia-50 p-5 sm:p-7">
          <div className="mb-6 flex items-center gap-3">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#2e026d] text-white shadow-lg shadow-violet-950/20">
              <Bed className="h-6 w-6" aria-hidden="true" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">Start a nap</h1>
          </div>

          <div className="grid gap-6">
            <fieldset>
              <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <Clock3 className="h-4 w-4" aria-hidden="true" />
                Duration
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {durationOptions.map((minutes) => (
                  <button
                    key={minutes}
                    type="button"
                    onClick={() => setDuration(minutes)}
                    className={`min-h-12 rounded-xl border px-2 text-sm font-semibold transition ${
                      duration === minutes
                        ? "border-[#2e026d] bg-[#2e026d] text-white"
                        : "border-slate-200 bg-white text-slate-700 hover:border-violet-300"
                    }`}
                  >
                    {minutes} min
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDuration("custom")}
                  className={`min-h-12 rounded-xl border px-2 text-sm font-semibold transition ${
                    duration === "custom"
                      ? "border-[#2e026d] bg-[#2e026d] text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:border-violet-300"
                  }`}
                >
                  Custom
                </button>
              </div>
              {duration === "custom" && (
                <label className="mt-3 block text-sm text-slate-600">
                  Minutes (15–480)
                  <input
                    type="number"
                    min={15}
                    max={480}
                    value={customDuration}
                    onChange={(event) => setCustomDuration(event.target.value)}
                    className="mt-1 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-950"
                  />
                </label>
              )}
            </fieldset>

            <div>
              <div className="mb-2 text-sm font-semibold text-slate-700">
                Temperature level
              </div>
              <div className="grid grid-cols-[3rem_minmax(0,1fr)_3rem] items-center gap-3">
                <button
                  type="button"
                  aria-label="Decrease nap temperature"
                  onClick={() =>
                    setTemperature((value) => Math.max(-10, value - 1))
                  }
                  className="grid h-12 w-12 place-items-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm"
                >
                  <Minus className="h-5 w-5" />
                </button>
                <div className="text-center">
                  <div className="text-4xl font-bold tabular-nums">
                    {temperature > 0 ? "+" : ""}
                    {temperature}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Increase nap temperature"
                  onClick={() =>
                    setTemperature((value) => Math.min(10, value + 1))
                  }
                  className="grid h-12 w-12 place-items-center rounded-xl border border-slate-200 bg-white text-slate-800 shadow-sm"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>

            <Button
              type="button"
              size="lg"
              className="h-12 w-full rounded-xl bg-[#2e026d] text-base text-white shadow-lg shadow-violet-950/20 hover:bg-[#3b0785]"
              disabled={!canStart || startNap.isPending}
              onClick={() => {
                setMessage(null);
                startNap.mutate({
                  targetEmails,
                  durationMinutes: resolvedDuration,
                  temperature,
                });
              }}
            >
              <Power className="mr-2 h-5 w-5" aria-hidden="true" />
              {startNap.isPending ? "Starting nap…" : "Start nap now"}
            </Button>
            {message && (
              <p className="text-center text-sm text-slate-600" role="status">
                {message}
              </p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
