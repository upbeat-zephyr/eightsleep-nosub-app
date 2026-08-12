"use client";
import React from "react";
import { LogOut } from "lucide-react";
import { apiR } from "~/trpc/react";

interface LogoutButtonProps {
  onLogoutSuccess: () => void;
  menuItem?: boolean;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({
  onLogoutSuccess,
  menuItem = false,
}) => {
  const logoutMutation = apiR.user.logout.useMutation({
    onSuccess: () => {
      // Handle successful logout
      console.log("Logout successful");
      onLogoutSuccess(); // Call the prop function on successful logout
    },
    onError: (error) => {
      // Handle logout error
      console.error("Logout failed:", error.message);
    },
  });

  const handleLogout = () => {
    logoutMutation.mutate();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleLogout}
        className={
          menuItem
            ? "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-60"
            : "flex min-h-10 items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-wait disabled:opacity-60"
        }
        disabled={logoutMutation.isPending}
      >
        <LogOut className="h-4 w-4" aria-hidden="true" />
        {logoutMutation.isPending ? "Logging out..." : "Logout"}
      </button>
      {logoutMutation.isError && (
        <p className="absolute right-4 top-14 z-10 rounded-md bg-red-950 px-3 py-2 text-sm text-white shadow-lg">
          {logoutMutation.error.message}
        </p>
      )}
    </>
  );
};
