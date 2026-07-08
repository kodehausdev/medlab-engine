"use client";

// Rendered in place of <LiveFeed> on Overview while the tenant is
// 'provisioning_pending_number' — self-serve WhatsApp number submission.
// Advances the tenant to 'provisioning_active' on success.

import { useState, type FormEvent } from "react";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

export function NumberIntake() {
  const { refreshTenant } = useAuth();
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/whatsapp-number", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ whatsapp_number: number.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save number.");
      await refreshTenant();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(15,23,42,0.25)]">
      <div className="mx-auto flex max-w-md flex-col gap-3.5 px-6 py-10 text-center">
        <h2 className="text-lg font-bold tracking-tight">Connect your WhatsApp line</h2>
        <p className="text-sm text-slate-500">
          Your card is on file — no charge yet. Give us the WhatsApp Business number your
          patients text, and we&apos;ll start configuring your engine instance.
        </p>
        <form onSubmit={onSubmit} className="mt-2 flex flex-col gap-3 text-left">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
            WhatsApp Business number
            <input
              required
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              placeholder="+14155551234"
              className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
            />
          </label>
          {error ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              {error}
            </div>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Submit number"}
          </button>
        </form>
      </div>
    </section>
  );
}
