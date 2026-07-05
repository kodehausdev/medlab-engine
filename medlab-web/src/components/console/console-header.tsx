"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "./dashboard-provider";

const TABS = [
  { href: "/overview", label: "Overview" },
  { href: "/call-logs", label: "Call Logs" },
  { href: "/scheduling", label: "Scheduling" },
  { href: "/compliance", label: "Compliance" },
];

function FlaskLogo() {
  return (
    <div className="grid size-8 flex-none place-items-center rounded-lg bg-gradient-to-br from-indigo-600 to-blue-600">
      <svg
        width="17"
        height="17"
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

export function ConsoleHeader() {
  const pathname = usePathname();
  const { connected, tenant } = useDashboard();

  return (
    <header className="sticky top-0 z-40 bg-slate-900 text-slate-50 shadow">
      <div className="mx-auto flex h-15 max-w-[1440px] items-center gap-4 px-6">
        <div className="flex min-w-0 items-center gap-3">
          <FlaskLogo />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-tight">
              {tenant?.lab_name ?? "MedLab AI"}
            </div>
            <div className="font-mono text-[10.5px] text-slate-400">
              AI RECEPTIONIST · CONSOLE
            </div>
          </div>
        </div>

        <nav className="ml-5 flex gap-0.5">
          {TABS.map((tab) => {
            const active = pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={
                  active
                    ? "rounded-md bg-indigo-500/25 px-3 py-1.5 text-[13px] font-semibold text-indigo-200"
                    : "rounded-md px-3 py-1.5 text-[13px] font-medium text-slate-400 hover:text-slate-200"
                }
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3.5">
          <div
            className={
              connected
                ? "flex items-center gap-2 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5"
                : "flex items-center gap-2 rounded-full border border-slate-600 bg-slate-800 px-3 py-1.5"
            }
          >
            <span
              className={
                connected
                  ? "size-1.5 rounded-full bg-emerald-400 [animation:pulse-dot_1.6s_ease-in-out_infinite]"
                  : "size-1.5 rounded-full bg-slate-500"
              }
            />
            <span
              className={
                connected
                  ? "font-mono text-[11px] font-semibold text-emerald-300"
                  : "font-mono text-[11px] font-semibold text-slate-400"
              }
            >
              {connected ? "ENGINE LIVE" : "ENGINE OFFLINE"}
            </span>
          </div>
          <div className="grid size-8 place-items-center rounded-full bg-slate-700 text-xs font-bold text-slate-300">
            DR
          </div>
        </div>
      </div>
    </header>
  );
}
