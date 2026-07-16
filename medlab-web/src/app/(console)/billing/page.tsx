"use client";

import { useState } from "react";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

const STATUS_STYLE: Record<string, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  trialing: "border-emerald-200 bg-emerald-50 text-emerald-700",
  past_due: "border-amber-200 bg-amber-50 text-amber-700",
  canceled: "border-red-200 bg-red-50 text-red-700",
  incomplete: "border-slate-200 bg-slate-50 text-slate-500",
};

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  trialing: "Active (trial)",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Not yet activated",
};

export default function BillingPage() {
  const { user, tenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openPortal() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/billing/portal-session", {
        method: "POST",
        headers: await authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not open billing portal.");
      window.location.href = data.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">Billing</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          Plan, invoices, and payment method — managed through Stripe.
        </p>
      </div>

      {!user || !tenant ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4.5 py-10 text-center text-sm text-slate-400">
          Sign in to a provisioned lab account to manage billing.
        </div>
      ) : (
        <div className="max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-bold text-slate-900">MedLab AI Receptionist — Pro</div>
              <div className="mt-0.5 font-mono text-xs text-slate-500">$297/mo per location</div>
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold whitespace-nowrap ${
                STATUS_STYLE[tenant.subscription_status ?? "incomplete"] ?? STATUS_STYLE.incomplete
              }`}
            >
              {STATUS_LABEL[tenant.subscription_status ?? "incomplete"] ?? tenant.subscription_status}
            </span>
          </div>

          {error ? (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </div>
          ) : null}

          <button
            onClick={() => void openPortal()}
            disabled={busy}
            className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Opening…" : "Manage billing →"}
          </button>
          <p className="mt-2.5 text-[11px] leading-relaxed text-slate-400">
            Opens Stripe&apos;s billing portal — update your card, download
            past invoices, or view your next charge date.
          </p>
        </div>
      )}
    </div>
  );
}
