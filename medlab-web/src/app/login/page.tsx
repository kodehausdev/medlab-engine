"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function FlaskLogo() {
  return (
    <div className="grid size-10 place-items-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-600">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinecap="round"
      >
        <path d="M9 3v7l-4.5 8a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L15 10V3" />
        <path d="M7.5 3h9" />
        <path d="M8 14h8" />
      </svg>
    </div>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in → straight to the console.
  useEffect(() => {
    supabase?.auth.getSession().then(({ data }) => {
      if (data.session) router.replace("/overview");
    });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace("/overview");
  }

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 p-5">
      <div className="w-full max-w-sm">
        <div className="mb-5 flex items-center gap-3">
          <FlaskLogo />
          <div>
            <div className="text-[15px] font-bold tracking-tight">
              MedLab AI
            </div>
            <div className="font-mono text-[10.5px] text-slate-500">
              AI RECEPTIONIST · CONSOLE
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-xs text-slate-500">
            Console access is provisioned per lab. Contact your administrator
            if you need an account.
          </p>

          {!supabase ? (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs leading-relaxed text-amber-800">
              Supabase isn&apos;t configured (<span className="font-mono">NEXT_PUBLIC_SUPABASE_URL</span>).
              Local dev without keys skips sign-in entirely.
            </div>
          ) : (
            <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@yourlab.com"
                className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
              />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="rounded-lg border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm outline-none focus:border-indigo-500 focus:bg-white"
              />
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-700">
                  {error}
                </div>
              ) : null}
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg bg-indigo-600 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-4 text-center font-mono text-[10.5px] text-slate-400">
          TENANT-SCOPED ACCESS · ENFORCED BY ROW-LEVEL SECURITY
        </p>
      </div>
    </div>
  );
}
