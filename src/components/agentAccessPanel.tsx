"use client";

import { useEffect, useState } from "react";
import { Bot, Check, Copy, KeyRound, ShieldCheck, Trash2 } from "lucide-react";
import { apiR } from "~/trpc/react";
import { Button } from "~/components/ui/button";

export function AgentAccessPanel() {
  const dashboard = apiR.agent.dashboard.useQuery();
  const [name, setName] = useState("Personal assistant");
  const [targets, setTargets] = useState<string[]>([]);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [copied, setCopied] = useState<"key" | "setup" | null>(null);
  const [expiresInDays, setExpiresInDays] = useState<number | null>(null);
  const [deleteToken, setDeleteToken] = useState<{
    id: string;
    name: string;
  } | null>(null);

  useEffect(() => {
    if (targets.length === 0 && dashboard.data?.members[0]) {
      setTargets([dashboard.data.members[0].email]);
    }
  }, [dashboard.data?.members, targets.length]);

  const create = apiR.agent.create.useMutation({
    onSuccess: (result) => {
      setNewToken(result.token);
      void dashboard.refetch();
    },
  });
  const deleteKey = apiR.agent.delete.useMutation({
    onSuccess: async () => {
      setDeleteToken(null);
      await dashboard.refetch();
    },
  });
  const apiUrl =
    typeof window === "undefined"
      ? "/api/agent/v1"
      : `${window.location.origin}/api/agent/v1`;
  const envSetup = newToken
    ? `EIGHTSLEEP_AGENT_API_URL="${apiUrl}"\nEIGHTSLEEP_AGENT_API_TOKEN="${newToken}"`
    : "";

  if (dashboard.isLoading) {
    return (
      <div className="py-12 text-center text-sm text-white/70">
        Loading agent access…
      </div>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-xl gap-4">
      <section className="rounded-3xl bg-white p-5 text-slate-950 shadow-2xl shadow-black/20 sm:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[#2e026d] text-white">
            <Bot className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Agent access</h1>
            <p className="text-sm text-slate-500">
              Create a revocable key for your assistant.
            </p>
          </div>
        </div>

        {newToken ? (
          <div className="grid gap-4">
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-semibold text-amber-950">Save this key now</p>
              <p className="mt-1 text-sm text-amber-800">
                It will not be shown again.
              </p>
              <code className="mt-3 block break-all rounded-xl bg-white p-3 text-xs ring-1 ring-amber-200">
                {newToken}
              </code>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">
                Add to your agent’s `.env` file
              </p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-all rounded-xl bg-slate-950 p-3 text-xs leading-5 text-slate-100">
                {envSetup}
              </pre>
              <p className="mt-2 text-xs text-slate-500">
                The URL tells the MCP adapter which deployed app to call. The
                token authorizes it.
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                className="border border-violet-200 bg-white text-violet-800 hover:bg-violet-50"
                onClick={async () => {
                  await navigator.clipboard.writeText(newToken);
                  setCopied("key");
                }}
              >
                {copied === "key" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied === "key" ? "Key copied" : "Copy key"}
              </Button>
              <Button
                type="button"
                className="bg-[#2e026d] text-white hover:bg-[#3d0788]"
                onClick={async () => {
                  await navigator.clipboard.writeText(envSetup);
                  setCopied("setup");
                }}
              >
                {copied === "setup" ? (
                  <Check className="mr-2 h-4 w-4" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                {copied === "setup" ? "Setup copied" : "Copy setup"}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => {
                setNewToken(null);
                setCopied(null);
              }}
              className="text-sm font-semibold text-violet-700"
            >
              I saved it
            </button>
          </div>
        ) : (
          <div className="grid gap-5">
            <label className="text-sm font-medium">
              Agent name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-slate-300 px-3"
              />
            </label>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">
                Allowed sides
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {dashboard.data?.members.map((member) => {
                  const selected = targets.includes(member.email);
                  return (
                    <button
                      key={member.email}
                      type="button"
                      onClick={() =>
                        setTargets((current) =>
                          selected
                            ? current.filter((email) => email !== member.email)
                            : [...current, member.email],
                        )
                      }
                      className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${
                        selected
                          ? "border-[#2e026d] bg-violet-50 text-[#2e026d]"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      {member.label}
                    </button>
                  );
                })}
                {(dashboard.data?.members.length ?? 0) > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      setTargets(
                        dashboard.data?.members.map((member) => member.email) ??
                          [],
                      )
                    }
                    className={`col-span-2 min-h-11 rounded-xl border px-3 text-sm font-semibold ${
                      targets.length === dashboard.data?.members.length
                        ? "border-[#2e026d] bg-violet-50 text-[#2e026d]"
                        : "border-slate-200 text-slate-600"
                    }`}
                  >
                    Both sides
                  </button>
                )}
              </div>
            </fieldset>
            <label className="text-sm font-semibold">
              Key expiration
              <select
                value={expiresInDays ?? "never"}
                onChange={(event) =>
                  setExpiresInDays(
                    event.target.value === "never"
                      ? null
                      : Number(event.target.value),
                  )
                }
                className="mt-2 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-slate-900 focus:border-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-200"
              >
                <option value="never">Never expires</option>
                <option value="30">30 days</option>
                <option value="90">90 days</option>
                <option value="180">180 days</option>
                <option value="365">1 year</option>
              </select>
            </label>
            <div className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              Full controls for selected sides. You can delete this key anytime.
            </div>
            <Button
              type="button"
              className="w-full bg-[#2e026d] text-white hover:bg-[#3d0788]"
              disabled={
                create.isPending || !name.trim() || targets.length === 0
              }
              onClick={() =>
                create.mutate({
                  name,
                  targetEmails: targets,
                  expiresInDays,
                })
              }
            >
              <KeyRound className="mr-2 h-4 w-4" />
              {create.isPending ? "Creating…" : "Create agent key"}
            </Button>
            {create.error && (
              <p className="text-sm text-red-700">{create.error.message}</p>
            )}
          </div>
        )}
      </section>

      {(dashboard.data?.tokens.length ?? 0) > 0 && (
        <section className="rounded-3xl bg-white p-5 text-slate-950 shadow-xl shadow-black/15">
          <h2 className="mb-3 font-bold">Agent keys</h2>
          <div className="grid gap-2">
            {dashboard.data?.tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-violet-700" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{token.name}</p>
                  <p className="text-xs text-slate-500">
                    {token.expiresAt
                      ? `Expires ${new Date(token.expiresAt).toLocaleDateString()}`
                      : "Never expires"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Delete ${token.name}`}
                  onClick={() =>
                    setDeleteToken({ id: token.id, name: token.name })
                  }
                  className="grid h-10 w-10 place-items-center rounded-lg text-rose-700 transition hover:bg-rose-100 hover:text-rose-900"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      {deleteToken && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-key-title"
          className="fixed inset-0 z-50 grid place-items-center bg-slate-950/70 p-4 backdrop-blur-sm"
        >
          <div className="w-full max-w-sm rounded-3xl bg-white p-6 text-slate-950 shadow-2xl">
            <div className="mb-4 grid h-11 w-11 place-items-center rounded-2xl bg-rose-100 text-rose-700">
              <Trash2 className="h-5 w-5" />
            </div>
            <h2 id="delete-key-title" className="text-xl font-bold">
              Delete agent key?
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              “{deleteToken.name}” will immediately stop working and disappear
              from this list. This cannot be undone.
            </p>
            {deleteKey.error && (
              <p className="mt-3 text-sm text-rose-700">
                {deleteKey.error.message}
              </p>
            )}
            <div className="mt-6 grid grid-cols-2 gap-2">
              <Button
                type="button"
                className="border border-slate-300 bg-white text-slate-800 hover:bg-slate-100"
                disabled={deleteKey.isPending}
                onClick={() => setDeleteToken(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-rose-700 text-white hover:bg-rose-800"
                disabled={deleteKey.isPending}
                onClick={() => deleteKey.mutate({ id: deleteToken.id })}
              >
                {deleteKey.isPending ? "Deleting…" : "Delete key"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
