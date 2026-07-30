"use client";
import React from "react";
import { apiR } from "~/trpc/react";

interface LogoutButtonProps {
  onLogoutSuccess: () => void;
}

export const LogoutButton: React.FC<LogoutButtonProps> = ({
  onLogoutSuccess,
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
        onClick={handleLogout}
        className="min-h-9 rounded-md border border-white/20 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#22024f] disabled:cursor-wait disabled:opacity-60"
        disabled={logoutMutation.isPending}
      >
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
