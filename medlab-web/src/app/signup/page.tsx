"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
];

const STEPS = ["Lab profile", "Owner account", "Review & payment"];

function FlaskLogo() {
  return (
    <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
        <path d="M9 3v7l-4.5 8a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 10V3" />
        <path d="M7.5 3h9" />
        <path d="M8 14h8" />
      </svg>
    </div>
  );
}

const inputCls =
  "rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white";

function SignupWizard() {
  const canceled = useSearchParams().get("canceled") === "1";
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(canceled ? "Payment was canceled — pick up where you left off." : null);

  const [labName, setLabName] = useState("");
  const [timezone, setTimezone] = useState(TIMEZONES[0]);
  const [openHour, setOpenHour] = useState(8);
  const [closeHour, setCloseHour] = useState(17);
  const [slotCapacity, setSlotCapacity] = useState(4);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  function next(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (step === 1 && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setStep((s) => s + 1);
  }

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labName, timezone, openHour, closeHour, slotCapacity, email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        setBusy(false);
        return;
      }
      window.location.href = data.url; // Stripe-hosted checkout
    } catch {
      setError("Network error — try again.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-100 py-10">
      <div className="mx-auto w-full max-w-lg px-5">
        <div className="mb-5 flex items-center gap-3">
          <FlaskLogo />
          <div>
            <div className="text-[15px] font-bold tracking-tight">MedLab AI</div>
            <div className="font-mono text-[10.5px] text-slate-500">NEW LAB SETUP</div>
          </div>
          <Link href="/login" className="ml-auto text-xs font-semibold text-indigo-700 hover:underline">
            Already set up? Sign in
          </Link>
        </div>

        {/* Stepper */}
        <div className="mb-5 flex items-center gap-2">
          {STEPS.map((label, i) => (
            <div key={label} className="flex flex-1 items-center gap-2">
              <span
                className={
                  i < step
                    ? "grid size-6 flex-none place-items-center rounded-full bg-green-100 text-[11px] font-bold text-green-700"
                    : i === step
                      ? "grid size-6 flex-none place-items-center rounded-full bg-indigo-600 text-[11px] font-bold text-white"
                      : "grid size-6 flex-none place-items-center rounded-full border border-slate-300 bg-white text-[11px] font-bold text-slate-400"
                }
              >
                {i < step ? "✓" : i + 1}
              </span>
              <span className={`text-xs font-medium whitespace-nowrap ${i === step ? "text-slate-900" : "text-slate-400"}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="h-0.5 flex-1 rounded bg-slate-200" />}
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          {error ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800">
              {error}
            </div>
          ) : null}

          {step === 0 && (
            <form onSubmit={next} className="flex flex-col gap-3.5">
              <h1 className="text-lg font-bold tracking-tight">Tell us about your lab</h1>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Lab / draw-station name
                <input required minLength={2} value={labName} onChange={(e) => setLabName(e.target.value)} placeholder="BrightPath Diagnostics — Midtown" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                Timezone
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={inputCls}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-3 gap-3">
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                  Opens
                  <select value={openHour} onChange={(e) => setOpenHour(Number(e.target.value))} className={inputCls}>
                    {Array.from({ length: 12 }, (_, h) => h + 5).map((h) => (
                      <option key={h} value={h}>{h}:00</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                  Closes
                  <select value={closeHour} onChange={(e) => setCloseHour(Number(e.target.value))} className={inputCls}>
                    {Array.from({ length: 12 }, (_, h) => h + 12).map((h) => (
                      <option key={h} value={h}>{h}:00</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1.5 text-xs font-semibold text-slate-600">
                  Draw chairs
                  <select value={slotCapacity} onChange={(e) => setSlotCapacity(Number(e.target.value))} className={inputCls}>
                    {[1, 2, 3, 4, 5, 6, 8].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="mt-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
                Continue
              </button>
            </form>
          )}

          {step === 1 && (
            <form onSubmit={next} className="flex flex-col gap-3.5">
              <h1 className="text-lg font-bold tracking-tight">Owner account</h1>
              <p className="-mt-1 text-xs text-slate-500">You&apos;ll use this to sign in to the console. Staff accounts come later.</p>
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@yourlab.com" className={inputCls} />
              <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password (min 8 characters)" className={inputCls} />
              <input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirm password" className={inputCls} />
              <div className="mt-1 flex gap-2.5">
                <button type="button" onClick={() => setStep(0)} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                  Back
                </button>
                <button type="submit" className="flex-1 rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700">
                  Continue
                </button>
              </div>
            </form>
          )}

          {step === 2 && (
            <div className="flex flex-col gap-4">
              <h1 className="text-lg font-bold tracking-tight">Review &amp; payment</h1>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
                <div className="flex justify-between py-1"><span className="text-slate-500">Lab</span><span className="font-semibold">{labName}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-500">Hours</span><span className="font-semibold">{openHour}:00 – {closeHour}:00 · {timezone.split("/")[1]?.replace("_", " ")}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-500">Draw chairs</span><span className="font-semibold">{slotCapacity}</span></div>
                <div className="flex justify-between py-1"><span className="text-slate-500">Owner</span><span className="font-semibold">{email}</span></div>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2.5">
                  <span className="text-slate-500">Plan</span>
                  <span className="font-bold">$297<span className="text-xs font-medium text-slate-500">/mo per location</span></span>
                </div>
              </div>
              <button onClick={startCheckout} disabled={busy} className="rounded-lg bg-indigo-600 py-3 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60">
                {busy ? "Preparing secure checkout…" : "Continue to secure payment →"}
              </button>
              <button onClick={() => setStep(1)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                ← Back
              </button>
              <p className="text-center font-mono text-[10px] text-slate-400">
                PAYMENT BY STRIPE · CANCEL ANYTIME · NO PATIENT DATA REQUIRED TO START
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupWizard />
    </Suspense>
  );
}
