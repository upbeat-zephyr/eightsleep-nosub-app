"use client";

import { useEffect, useState } from "react";
import { CalendarDays, Check, Plane, Power } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";

type HouseholdMember = {
  email: string;
  label: string;
  isSelf: boolean;
};

function dateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function AwayPanel({ members }: { members: HouseholdMember[] }) {
  const awayStatus = apiR.away.status.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const [target, setTarget] = useState("");
  const [days, setDays] = useState<number | "custom">(3);
  const [returnDate, setReturnDate] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return dateInputValue(date);
  });
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const self = members.find((member) => member.isSelf) ?? members[0];
    if (!target && self) setTarget(self.email);
  }, [members, target]);

  const startAway = apiR.away.start.useMutation({
    onSuccess: (result) => {
      setMessage(
        result.failed.length
          ? "Away mode started on one side; the other side could not be reached."
          : "Away mode is active. Automation is paused.",
      );
      void awayStatus.refetch();
    },
    onError: (error) => setMessage(error.message),
  });
  const clearAway = apiR.away.clear.useMutation({
    onSuccess: () => {
      setMessage("Away mode ended. Automation is active again.");
      void awayStatus.refetch();
    },
    onError: (error) => setMessage(error.message),
  });

  const targetEmails =
    target === "both" ? members.map((member) => member.email) : [target];
  const getEndsAt = () => {
    if (days === "custom") {
      const date = new Date(`${returnDate}T12:00:00`);
      return date;
    }
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date;
  };
  const customReturnIsValid =
    days !== "custom" || Number.isFinite(getEndsAt().getTime());

  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
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

      {awayStatus.data?.periods.map((period) => {
        const member = members.find(
          (candidate) => candidate.email === period.targetEmail,
        );
        return (
          <div
            key={period.targetEmail}
            className="flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 p-4 text-white"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-300 text-amber-950">
              <Plane className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{member?.label ?? "Side"} is away</p>
              <p className="text-sm text-white/65">
                Until {new Date(period.endsAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-white/20 bg-white/10 text-white hover:bg-white/20 hover:text-white"
              disabled={clearAway.isPending}
              onClick={() =>
                clearAway.mutate({ targetEmails: [period.targetEmail] })
              }
            >
              End
            </Button>
          </div>
        );
      })}

      <section className="rounded-3xl bg-white p-5 text-slate-950 shadow-2xl shadow-black/20 sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#2e026d] text-white">
            <Plane className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Away</h1>
            <p className="text-sm text-slate-500">
              Pause automation while traveling.
            </p>
          </div>
        </div>

        <div className="grid gap-5">
          <fieldset>
            <legend className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              Return
            </legend>
            <div className="grid grid-cols-4 gap-2">
              {[1, 3, 7].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className={`h-11 rounded-xl border px-1 text-sm font-semibold ${
                    days === option
                      ? "border-[#2e026d] bg-[#2e026d] text-white"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  {option}d
                </button>
              ))}
              <button
                type="button"
                onClick={() => setDays("custom")}
                className={`h-11 rounded-xl border px-1 text-sm font-semibold ${
                  days === "custom"
                    ? "border-[#2e026d] bg-[#2e026d] text-white"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                Date
              </button>
            </div>
            {days === "custom" && (
              <input
                type="date"
                value={returnDate}
                min={dateInputValue(new Date())}
                onChange={(event) => setReturnDate(event.target.value)}
                className="mt-3 h-11 w-full rounded-xl border border-slate-300 px-3"
                aria-label="Return date"
              />
            )}
          </fieldset>

          <Button
            type="button"
            size="lg"
            className="h-12 w-full rounded-xl bg-[#2e026d] text-base text-white hover:bg-[#3b0785]"
            disabled={
              startAway.isPending ||
              !customReturnIsValid ||
              targetEmails.some((email) => !email)
            }
            onClick={() => {
              setMessage(null);
              startAway.mutate({
                targetEmails,
                endsAt: getEndsAt().toISOString(),
              });
            }}
          >
            {startAway.isPending ? (
              "Starting away mode…"
            ) : (
              <>
                <Power className="mr-2 h-5 w-5" aria-hidden="true" />
                Turn off and pause
              </>
            )}
          </Button>
          {message && (
            <p className="text-center text-sm text-slate-600" role="status">
              <Check className="mr-1 inline h-4 w-4" aria-hidden="true" />
              {message}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
