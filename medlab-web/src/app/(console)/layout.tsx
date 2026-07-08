"use client";

import type { ReactNode } from "react";
import { AuthGate, useAuth } from "@/components/auth/auth-gate";
import { DashboardProvider } from "@/components/console/dashboard-provider";
import { ConsoleHeader } from "@/components/console/console-header";
import { PaymentGate } from "@/components/console/payment-gate";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <OnboardingGate>{children}</OnboardingGate>
    </AuthGate>
  );
}

function OnboardingGate({ children }: { children: ReactNode }) {
  const { tenant } = useAuth();
  // Nothing to show until a card is on file — no nav, no dashboard.
  if (tenant?.onboarding_state === "payment_pending") return <PaymentGate />;
  return <ConsoleShell>{children}</ConsoleShell>;
}

function ConsoleShell({ children }: { children: ReactNode }) {
  return (
    <DashboardProvider>
      <div className="flex min-h-screen flex-col">
        <ConsoleHeader />
        <main className="mx-auto w-full max-w-[1440px] flex-1 p-6">
          {children}
        </main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-4 px-6 py-3.5">
            <span className="font-mono text-[11.5px] text-slate-400">
              MedLab AI Receptionist · console v0.1
            </span>
            <span className="ml-auto text-[11.5px] text-slate-400">
              All transcripts sanitized at ingestion — raw audio is never
              persisted.
            </span>
          </div>
        </footer>
      </div>
    </DashboardProvider>
  );
}
