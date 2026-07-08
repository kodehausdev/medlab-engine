"use client";

// Full-screen gate rendered by (console)/layout.tsx while a tenant is
// 'payment_pending'. Collects a card via an embedded Stripe PaymentElement
// against a $0 SetupIntent (/api/onboarding/setup-intent) — no charge here;
// the real $297/mo subscription is created later by ops
// (scripts/activate-tenant.mjs) once provisioning is done.

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from "@stripe/react-stripe-js";
import { useAuth } from "@/components/auth/auth-gate";
import { authHeaders } from "@/lib/auth-headers";

const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
const stripePromise = publishableKey ? loadStripe(publishableKey) : null;

async function confirmCard(setupIntentId: string) {
  const res = await fetch("/api/onboarding/confirm-card", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ setup_intent_id: setupIntentId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Could not confirm card.");
}

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const { refreshTenant } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);
    try {
      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
        confirmParams: { return_url: window.location.href },
      });
      if (confirmError) throw new Error(confirmError.message ?? "Card was declined.");
      if (!setupIntent) throw new Error("No confirmation returned.");
      await confirmCard(setupIntent.id);
      await refreshTenant();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <PaymentElement
        options={{
          defaultValues: { billingDetails: { address: { country: "US" } } },
          // Suppress Link's own "save my info" enrollment card — we collect
          // the contact details we need (email at signup, WhatsApp number in
          // the next onboarding step) ourselves; Stripe Link would otherwise
          // save them into Stripe's separate cross-merchant network instead.
          wallets: { link: "never" },
        }}
      />
      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
          {error}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={busy || !stripe}
        className="rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
      >
        {busy ? "Securing your card…" : "Secure my AI engine instance →"}
      </button>
    </form>
  );
}

function PaymentGateInner() {
  const searchParams = useSearchParams();
  const { refreshTenant } = useAuth();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Stripe appends these to return_url after an off-page confirmation step
  // (e.g. 3-D Secure) — resolve that before showing the form again.
  const [resolvingRedirect, setResolvingRedirect] = useState(
    searchParams.get("redirect_status") === "succeeded"
  );

  useEffect(() => {
    const setupIntentId = searchParams.get("setup_intent");
    void (async () => {
      await Promise.resolve(); // defer past this render, even on the no-op path
      if (resolvingRedirect && setupIntentId) {
        try {
          await confirmCard(setupIntentId);
          await refreshTenant();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Something went wrong.");
        }
      }
      setResolvingRedirect(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (resolvingRedirect) return;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/setup-intent", {
          method: "POST",
          headers: await authHeaders(),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Could not start checkout.");
        setClientSecret(data.clientSecret);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    })();
  }, [resolvingRedirect]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <h1 className="text-lg font-bold tracking-tight">Secure your AI engine instance</h1>
        <p className="mt-2 text-sm text-slate-500">
          We&apos;re about to dedicate a private AI engine instance and WhatsApp routing to your
          lab.
        </p>

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium text-slate-500">Today&apos;s total</span>
            <span className="text-2xl font-bold tracking-tight">$0.00</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500">
            We require a card to dedicate an AI engine instance and routing. Subscription begins
            only when your line goes live — $297/mo, cancel anytime.
          </p>
        </div>

        {error ? (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5">
          {resolvingRedirect ? (
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <span className="size-2 rounded-full bg-indigo-600 [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
              Confirming your card…
            </div>
          ) : !stripePromise ? (
            <div className="text-xs text-amber-700">
              Stripe isn&apos;t configured (NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY missing).
            </div>
          ) : clientSecret ? (
            <Elements stripe={stripePromise} options={{ clientSecret, locale: "en" }}>
              <CardForm />
            </Elements>
          ) : (
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <span className="size-2 rounded-full bg-indigo-600 [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
              Preparing secure checkout…
            </div>
          )}
        </div>

        <p className="mt-4 text-center font-mono text-[10px] text-slate-400">
          PAYMENT BY STRIPE · NO CHARGE TODAY · CANCEL ANYTIME
        </p>
      </div>
    </div>
  );
}

export function PaymentGate() {
  return (
    <Suspense>
      <PaymentGateInner />
    </Suspense>
  );
}
