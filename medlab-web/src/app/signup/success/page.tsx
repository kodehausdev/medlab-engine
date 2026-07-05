"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface ActivatedTenant {
  id: string;
  lab_name: string;
  slot_capacity: number;
  open_hour: number;
  close_hour: number;
}

const CHECKLIST = [
  { label: "Subscription active", state: "done" },
  { label: "Console account created", state: "done" },
  { label: "Tenant provisioned", state: "done" },
  { label: "Phone line connected", state: "next" },
  { label: "First test call", state: "todo" },
];

function SuccessInner() {
  const sessionId = useSearchParams().get("session_id");
  const [tenant, setTenant] = useState<ActivatedTenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("Missing checkout session.");
      return;
    }
    fetch("/api/onboarding/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Activation failed.");
        setTenant(data.tenant);
      })
      .catch((e: Error) => setError(e.message));
  }, [sessionId]);

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
          {error ? (
            <>
              <h1 className="text-lg font-bold tracking-tight text-red-700">Activation problem</h1>
              <p className="mt-2 text-sm text-slate-600">{error}</p>
              <Link href="/signup" className="mt-4 inline-block text-sm font-semibold text-indigo-700 hover:underline">
                ← Back to setup
              </Link>
            </>
          ) : !tenant ? (
            <div className="flex items-center gap-2.5 text-sm text-slate-500">
              <span className="size-2 rounded-full bg-indigo-600 [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
              Confirming your subscription…
            </div>
          ) : (
            <>
              <div className="grid size-12 place-items-center rounded-full bg-green-100 text-xl text-green-700">✓</div>
              <h1 className="mt-3 text-xl font-bold tracking-tight">{tenant.lab_name} is live</h1>
              <p className="mt-1 text-sm text-slate-500">
                Subscription active · {tenant.slot_capacity} chairs · {tenant.open_hour}:00–{tenant.close_hour}:00
              </p>

              <div className="mt-5 flex flex-col">
                {CHECKLIST.map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5 border-t border-slate-100 py-2.5 first:border-t-0">
                    <span
                      className={
                        item.state === "done"
                          ? "grid size-4.5 place-items-center rounded-full bg-green-100 text-[10px] font-bold text-green-700"
                          : item.state === "next"
                            ? "grid size-4.5 place-items-center rounded-full bg-indigo-100 text-[10px] font-bold text-indigo-700"
                            : "grid size-4.5 place-items-center rounded-full border border-slate-300 text-[10px] font-bold text-slate-300"
                      }
                    >
                      {item.state === "done" ? "✓" : ""}
                    </span>
                    <span className={`text-sm ${item.state === "todo" ? "text-slate-400" : "font-medium"}`}>
                      {item.label}
                    </span>
                    {item.state === "next" ? (
                      <span className="ml-auto font-mono text-[10px] font-semibold text-indigo-600">WE&apos;LL REACH OUT</span>
                    ) : null}
                  </div>
                ))}
              </div>

              <Link
                href="/login"
                className="mt-5 block rounded-lg bg-indigo-600 py-2.5 text-center text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Sign in to your console →
              </Link>
              <p className="mt-3 text-center font-mono text-[10px] text-slate-400">
                PHONE-LINE SETUP IS WHITE-GLOVE FOR NOW — EXPECT AN EMAIL WITHIN ONE BUSINESS DAY
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function SignupSuccessPage() {
  return (
    <Suspense>
      <SuccessInner />
    </Suspense>
  );
}
