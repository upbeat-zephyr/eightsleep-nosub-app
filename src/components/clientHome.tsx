"use client";

import { useState } from "react";
import { EightLoginDialog } from "~/components/eightLogin";
import { LogoutButton } from "~/components/logout";
import { AutomationSettingsForm } from "~/components/automationSettingsForm";

export default function ClientHome({
  initialLoginState,
}: {
  initialLoginState: boolean;
}) {
  const [isLoggedIn, setIsLoggedIn] = useState(initialLoginState);

  if (isLoggedIn) {
    return (
      <main className="min-h-screen bg-gradient-to-b from-[#2e026d] to-[#15162c] text-white">
        <nav
          aria-label="Application"
          className="border-b border-white/10 bg-[#22024f]/70"
        >
          <div className="container flex h-14 items-center justify-between px-4">
            <span className="text-base font-bold tracking-tight">
              Eightsleep <span className="text-[hsl(280,100%,70%)]">Nosub</span>
            </span>
            <LogoutButton onLogoutSuccess={() => setIsLoggedIn(false)} />
          </div>
        </nav>
        <div className="container flex min-w-0 justify-center px-3 py-4 sm:px-4 sm:py-8">
          <AutomationSettingsForm />
        </div>
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
