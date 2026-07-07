"use client";

import Link from "next/link";
import type { DashboardEvent } from "@/lib/engine";
import { StatusBadge, kindForEvent } from "./status-badge";
import { useDashboard } from "./dashboard-provider";

function timeOf(ev: DashboardEvent) {
  return new Date(ev.ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function rowFor(ev: DashboardEvent) {
  const phone = ev.phone_tail ? `••• ${ev.phone_tail}` : "unknown";
  const anonymousAvatar = ev.phone_tail ? ev.phone_tail.slice(-2) : "?";
  if (ev.type === "booking.confirmed") {
    const name = ev.data.patient_name ?? "Caller";
    return {
      name,
      phone,
      test: ev.data.test_type ?? null,
      summary:
        ev.data.summary ??
        `Booked ${ev.data.date} at ${ev.data.time_slot} via ${ev.channel}.`,
      avatar: "bg-indigo-100 text-indigo-700",
      avatarLabel: ev.data.patient_name ? initialsOf(name) : anonymousAvatar,
    };
  }
  if (ev.type === "guardrail.redacted") {
    return {
      name: `Caller ${phone}`,
      phone,
      test: null,
      summary:
        ev.data.summary ??
        "PHI intercepted and redacted by the compliance layer before storage.",
      avatar: "bg-red-100 text-red-700",
      avatarLabel: anonymousAvatar,
    };
  }
  return {
    name: `Caller ${phone}`,
    phone,
    test: null,
    summary: `Inbound ${ev.channel} conversation answered by the AI.`,
    avatar: "bg-slate-100 text-slate-600",
    avatarLabel: anonymousAvatar,
  };
}

function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const EMPTY_TEXT: Record<string, string> = {
  "engine-live": "Waiting for the first call — events appear here in real time.",
  "engine-unlinked":
    "No events yet. Your phone line isn't provisioned on the engine — history from the audit trail will appear here as calls happen.",
  offline: "Engine offline. Start medlab-engine and this feed reconnects automatically.",
  connecting: "Connecting…",
};

export function LiveFeed({ limit }: { limit?: number }) {
  const { status, events } = useDashboard();
  const visible = limit ? events.slice(0, limit) : events;

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_20px_-14px_rgba(15,23,42,0.25)]">
      <div className="flex flex-wrap items-center gap-2.5 border-b border-slate-200 px-4.5 py-3.5">
        <span className="size-2 flex-none rounded-full bg-indigo-600 [animation:pulse-dot_1.6s_ease-in-out_infinite]" />
        <h2 className="text-sm font-bold tracking-tight">
          Live Patient Call Feed
        </h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">
          {events.length} events
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1">
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#b45309"
            strokeWidth="2.4"
            strokeLinecap="round"
            className="flex-none"
          >
            <path d="M12 9v4M12 17h.01" />
            <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          </svg>
          <span className="text-[11px] font-medium text-amber-800">
            Guardrail rows are metadata only — never caller content
          </span>
        </span>
      </div>

      {visible.length === 0 ? (
        <div className="px-4.5 py-10 text-center text-sm text-slate-400">
          {EMPTY_TEXT[status]}
        </div>
      ) : (
        <div>
          {visible.map((ev) => {
            const row = rowFor(ev);
            const isGuardrail = ev.type === "guardrail.redacted";
            return (
              <div
                key={ev.id}
                className={`flex items-center gap-3.5 border-b border-slate-100 px-4.5 py-3 [animation:row-in_.35s_ease] last:border-b-0 hover:bg-slate-50/70 ${
                  isGuardrail ? "bg-red-50/50" : ""
                }`}
              >
                <span
                  className={`grid size-9 flex-none place-items-center rounded-full text-[11px] font-bold ${row.avatar}`}
                >
                  {row.avatarLabel}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-semibold">
                      {row.name}
                    </span>
                    {row.test ? (
                      <span className="flex-none truncate rounded-md bg-slate-100 px-1.5 py-0.5 text-[10.5px] font-medium text-slate-600">
                        {row.test}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {row.summary}
                  </div>
                </div>
                <div className="flex flex-none flex-col items-end gap-1">
                  <StatusBadge kind={kindForEvent(ev)} />
                  <span className="font-mono text-[10.5px] text-slate-400">
                    {row.phone} · {timeOf(ev)} ·{" "}
                    {ev.channel === "whatsapp" ? "WA" : ev.channel.toUpperCase()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {limit && events.length > limit ? (
        <Link
          href="/call-logs"
          className="flex items-center justify-center gap-1.5 border-t border-slate-200 bg-slate-50 px-4.5 py-2.5 text-xs font-semibold text-indigo-600 hover:bg-slate-100"
        >
          View all {events.length} events in Call Logs
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </Link>
      ) : null}
    </section>
  );
}
