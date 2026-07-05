"use client";

// Client-side auth gate for the console. UX only — the actual security
// boundary is Postgres RLS: an unauthenticated session holds the anon key,
// which can read zero rows. This gate just keeps signed-out users on /login.
//
// When Supabase env isn't configured (bare local dev), the gate is open so
// the console still works against the engine's SSE feed.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import type { EngineState } from "@/lib/engine";

export type AuthTenant = EngineState["tenant"];

interface AuthContextValue {
  user: User | null;
  /** The signed-in user's lab, fetched under RLS — null in keyless dev mode. */
  tenant: AuthTenant | null;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  tenant: null,
  signOut: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [tenant, setTenant] = useState<AuthTenant | null>(null);
  const [status, setStatus] = useState<"loading" | "out" | "in">(
    supabase ? "loading" : "in"
  );

  useEffect(() => {
    const sb = supabase;
    if (!sb) return;

    // RLS returns exactly the caller's own tenant row.
    const loadTenant = async (haveSession: boolean) => {
      if (!haveSession) {
        setTenant(null);
        return;
      }
      const { data } = await sb
        .from("tenants")
        .select("id, lab_name, open_hour, close_hour, slot_capacity")
        .single();
      setTenant((data as AuthTenant) ?? null);
    };

    sb.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setStatus(data.session ? "in" : "out");
      void loadTenant(Boolean(data.session));
    });

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setStatus(session ? "in" : "out");
      void loadTenant(Boolean(session));
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (status === "out") router.replace("/login");
  }, [status, router]);

  const signOut = async () => {
    await supabase?.auth.signOut();
  };

  if (status !== "in") {
    return (
      <div className="grid min-h-screen place-items-center bg-slate-100">
        <div className="flex items-center gap-2.5 text-sm text-slate-500">
          <span className="size-2 rounded-full bg-indigo-600 [animation:pulse-dot_1.2s_ease-in-out_infinite]" />
          {status === "loading" ? "Checking session…" : "Redirecting to sign in…"}
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, tenant, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
