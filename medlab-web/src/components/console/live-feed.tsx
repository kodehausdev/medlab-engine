"use client";

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
  if (ev.type === "booking.confirmed") {
    return {
      name: ev.data.patient_name ?? "Caller",
      phone,
      test: ev.data.test_type ?? "—",
      summary:
        ev.data.summary ??
        `Booked ${ev.data.date} at ${ev.data.time_slot} via ${ev.channel}.`,
      tint: "",
    };
  }
  if (ev.type === "guardrail.redacted") {
    return {
      name: `Caller ${phone}`,
      phone,
      test: "—",
      summary:
        ev.data.summary ??
        "PHI intercepted and redacted by the compliance layer before storage.",
      tint: "bg-red-50/60",
    };
  }
  return {
    name: `Caller ${phone}`,
    phone,
    test: "—",
    summary: `Inbound ${ev.channel} conversation answered by the AI.`,
    tint: "",
  };
}

export function LiveFeed() {
  const { connected, events } = useDashboard();

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-2.5 border-b border-slate-200 px-4.5 py-3.5">
        <span className="size-2 flex-none rounded-full bg-indigo-600 [animation:pulse-dot_1.6s_ease-in-out_infinite]" />
        <h2 className="text-sm font-bold tracking-tight">
          Live Patient Call Feed
        </h2>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-500">
          {events.length} events
        </span>
      </div>

      <div className="grid grid-cols-[150px_140px_170px_minmax(180px,1fr)] gap-x-3 border-b border-slate-200 bg-slate-50 px-4.5 py-2">
        {["Patient", "Requested Test", "Status", "AI Summary"].map((h) => (
          <span
            key={h}
            className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500"
          >
            {h}
          </span>
        ))}
      </div>

      {events.length === 0 ? (
        <div className="px-4.5 py-10 text-center text-sm text-slate-400">
          {connected
            ? "Waiting for the first call — events appear here in real time."
            : "Engine offline. Start medlab-engine and this feed reconnects automatically."}
        </div>
      ) : (
        events.map((ev) => {
          const row = rowFor(ev);
          return (
            <div
              key={ev.id}
              className={`grid grid-cols-[150px_140px_170px_minmax(180px,1fr)] items-center gap-x-3 border-b border-slate-100 px-4.5 py-3 [animation:row-in_.35s_ease] ${row.tint}`}
            >
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold">
                  {row.name}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-slate-400">
                  {row.phone} · {timeOf(ev)} ·{" "}
                  {ev.channel === "whatsapp" ? "WA" : ev.channel.toUpperCase()}
                </div>
              </div>
              <div className="min-w-0 truncate text-[12.5px] font-medium text-slate-700">
                {row.test}
              </div>
              <div>
                <StatusBadge kind={kindForEvent(ev)} />
              </div>
              <div className="min-w-0 text-xs leading-relaxed text-slate-500">
                {row.summary}
              </div>
            </div>
          );
        })
      )}

      <div className="flex items-center gap-2 border-t border-amber-200 bg-amber-50 px-4.5 py-2.5">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#b45309"
          strokeWidth="2.2"
          strokeLinecap="round"
          className="flex-none"
        >
          <path d="M12 9v4M12 17h.01" />
          <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        </svg>
        <span className="text-xs text-amber-800">
          Rows marked <strong className="font-bold">Guardrail Redacted</strong>{" "}
          contain PHI the engine intercepted before storage. Nothing shown here
          includes caller content — event metadata only.
        </span>
      </div>
    </section>
  );
}
