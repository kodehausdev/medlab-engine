import type { ReactNode } from "react";
import { DashboardProvider } from "@/components/console/dashboard-provider";
import { ConsoleHeader } from "@/components/console/console-header";

export default function ConsoleLayout({ children }: { children: ReactNode }) {
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
