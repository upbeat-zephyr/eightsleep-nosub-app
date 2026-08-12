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
  const [copied, setCopied] = useState(false);

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
  const revoke = apiR.agent.revoke.useMutation({
    onSuccess: () => void dashboard.refetch(),
  });

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
            <Button
              type="button"
              className="w-full"
              onClick={async () => {
                await navigator.clipboard.writeText(newToken);
                setCopied(true);
              }}
            >
              {copied ? (
                <Check className="mr-2 h-4 w-4" />
              ) : (
                <Copy className="mr-2 h-4 w-4" />
              )}
              {copied ? "Copied" : "Copy key"}
            </Button>
            <button
              type="button"
              onClick={() => {
                setNewToken(null);
                setCopied(false);
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
              </div>
            </fieldset>
            <div className="flex gap-2 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">
              <ShieldCheck className="h-5 w-5 shrink-0" />
              Full controls for selected sides. Expires in 180 days and can be
              revoked anytime.
            </div>
            <Button
              type="button"
              className="w-full"
              disabled={
                create.isPending || !name.trim() || targets.length === 0
              }
              onClick={() =>
                create.mutate({
                  name,
                  targetEmails: targets,
                  expiresInDays: 180,
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
        <section className="rounded-2xl border border-white/10 bg-white/10 p-4 text-white backdrop-blur">
          <h2 className="mb-3 font-semibold">Agent keys</h2>
          <div className="grid gap-2">
            {dashboard.data?.tokens.map((token) => (
              <div
                key={token.id}
                className="flex items-center gap-3 rounded-xl bg-black/10 p-3"
              >
                <KeyRound className="h-4 w-4 shrink-0 text-fuchsia-300" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{token.name}</p>
                  <p className="text-xs text-white/55">
                    {token.revokedAt
                      ? "Revoked"
                      : `Expires ${new Date(token.expiresAt).toLocaleDateString()}`}
                  </p>
                </div>
                {!token.revokedAt && (
                  <button
                    type="button"
                    aria-label={`Revoke ${token.name}`}
                    onClick={() => revoke.mutate({ id: token.id })}
                    className="grid h-10 w-10 place-items-center rounded-lg text-white/65 hover:bg-white/10 hover:text-white"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
