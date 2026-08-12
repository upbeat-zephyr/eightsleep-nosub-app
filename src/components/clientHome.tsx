"use client";

import { useEffect, useState } from "react";
import { CalendarClock, Clock3, Moon, Sparkles } from "lucide-react";
import { EightLoginDialog } from "~/components/eightLogin";
import { LogoutButton } from "~/components/logout";
import { AutomationSettingsForm } from "~/components/automationSettingsForm";
import { NapPanel } from "~/components/napPanel";
import { apiR } from "~/trpc/react";

export default function ClientHome({
  initialLoginState,
}: {
  initialLoginState: boolean;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialLoginState);
  const [activeView, setActiveView] = useState<"nap" | "automation" | "once">(
    "nap",
  );
  const [automationTarget, setAutomationTarget] = useState("");
  const household = apiR.nap.dashboard.useQuery(undefined, {
    enabled: isLoggedIn,
    refetchInterval: activeView === "nap" ? 60_000 : false,
    retry: 1,
  });

  useEffect(() => {
    const self = household.data?.members.find((member) => member.isSelf);
    if (!automationTarget && self) setAutomationTarget(self.email);
  }, [automationTarget, household.data?.members]);

  if (isLoggedIn) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_right,_#5b21b6_0,_#2e026d_32%,_#15162c_76%)] text-white">
        <nav
          aria-label="Application"
          className="border-b border-white/10 bg-[#160b35]/70 backdrop-blur-xl"
        >
          <div className="container flex h-14 items-center justify-between px-4">
            <span className="flex items-center gap-2 text-base font-bold tracking-tight">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-white/10 text-fuchsia-300 ring-1 ring-white/15">
                <Moon className="h-4 w-4" aria-hidden="true" />
              </span>
              <span>
                Eightsleep <span className="text-fuchsia-300">Nosub</span>
              </span>
            </span>
            <LogoutButton onLogoutSuccess={() => setIsLoggedIn(false)} />
          </div>
        </nav>
        <div className="container min-w-0 px-3 pb-28 pt-4 sm:px-4 sm:pt-7 md:pb-10">
          <div className="mx-auto mb-5 hidden max-w-xl grid-cols-3 gap-1 rounded-2xl border border-white/10 bg-white/10 p-1 backdrop-blur md:grid">
            <AppNavButton
              active={activeView === "nap"}
              label="Nap"
              icon={<Sparkles className="h-4 w-4" />}
              onClick={() => setActiveView("nap")}
            />
            <AppNavButton
              active={activeView === "automation"}
              label="Automation"
              icon={<CalendarClock className="h-4 w-4" />}
              onClick={() => setActiveView("automation")}
            />
            <AppNavButton
              active={activeView === "once"}
              label="Once"
              icon={<Clock3 className="h-4 w-4" />}
              onClick={() => setActiveView("once")}
            />
          </div>

          {household.isLoading ? (
            <div className="py-12 text-center text-sm text-white/70">
              Loading your bed…
            </div>
          ) : household.isError && !household.data ? (
            <div className="mx-auto max-w-xl rounded-2xl border border-red-200/20 bg-red-950/30 p-5 text-center">
              <p className="font-semibold">Your bed could not be loaded.</p>
              <p className="mt-1 text-sm text-white/65">
                {household.error.message}
              </p>
              <button
                type="button"
                className="mt-4 min-h-10 rounded-xl bg-white px-4 text-sm font-semibold text-[#2e026d]"
                onClick={() => household.refetch()}
              >
                Try again
              </button>
            </div>
          ) : activeView === "nap" ? (
            <NapPanel
              members={household.data?.members ?? []}
              sessions={household.data?.sessions ?? []}
              refreshDashboard={() => void household.refetch()}
            />
          ) : (
            <div className="mx-auto grid max-w-xl gap-4">
              {(household.data?.members.length ?? 0) > 1 && (
                <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/10 p-1 backdrop-blur">
                  {household.data?.members.map((member) => (
                    <button
                      key={member.email}
                      type="button"
                      onClick={() => setAutomationTarget(member.email)}
                      className={`min-h-10 rounded-lg px-3 text-sm font-semibold transition ${
                        automationTarget === member.email
                          ? "bg-white text-[#2e026d] shadow"
                          : "text-white/70 hover:text-white"
                      }`}
                    >
                      {member.label}
                    </button>
                  ))}
                </div>
              )}
              {automationTarget && (
                <AutomationSettingsForm
                  key={automationTarget}
                  targetEmail={automationTarget}
                  mode={activeView}
                />
              )}
            </div>
          )}
        </div>

        <nav
          aria-label="Features"
          className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#160b35]/95 px-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl md:hidden"
        >
          <div className="mx-auto grid max-w-md grid-cols-3 gap-1">
            <AppNavButton
              active={activeView === "nap"}
              label="Nap"
              icon={<Sparkles className="h-5 w-5" />}
              onClick={() => setActiveView("nap")}
            />
            <AppNavButton
              active={activeView === "automation"}
              label="Automation"
              icon={<CalendarClock className="h-5 w-5" />}
              onClick={() => setActiveView("automation")}
            />
            <AppNavButton
              active={activeView === "once"}
              label="Once"
              icon={<Clock3 className="h-5 w-5" />}
              onClick={() => setActiveView("once")}
            />
          </div>
        </nav>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
      <div className="container flex flex-col items-center justify-center gap-12 px-4 py-16">
        <h1 className="text-center text-5xl font-extrabold tracking-tight sm:text-[5rem]">
          Eightsleep <span className="text-[hsl(280,100%,70%)]">Nosub</span> App
        </h1>
        <p className="text-center text-base text-white/80">
          Configure on/off times, timezone, and your initial temperature inside
          the app.
        </p>
        <EightLoginDialog onLoginSuccess={() => setIsLoggedIn(true)} />
      </div>
    </main>
  );
}

function AppNavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={`flex min-h-12 items-center justify-center gap-1.5 rounded-xl px-2 text-sm font-semibold transition [&>svg]:shrink-0 ${
        active
          ? "bg-white text-[#2e026d] shadow-lg"
          : "text-white/65 hover:bg-white/5 hover:text-white"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
