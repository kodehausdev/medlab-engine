"use client";

import { useState } from "react";
import { useAuditTrail } from "@/hooks/use-audit-trail";
import { StatusBadge } from "@/components/console/status-badge";
import type { AuditRow } from "@/lib/supabase";

const FILTERS = [
  { key: "all", label: "All events" },
  { key: "booking.confirmed", label: "Booked" },
  { key: "guardrail.redacted", label: "Guardrail events" },
  { key: "call.answered", label: "Answered" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function badgeKind(row: AuditRow) {
  if (row.type === "booking.confirmed") return "booked" as const;
  if (row.type === "guardrail.redacted") return "guardrail" as const;
  return "answered" as const;
}

function describe(row: AuditRow): { patient: string; test: string; summary: string } {
  const phone = row.phone_tail ? `••• ${row.phone_tail}` : "unknown";
  if (row.type === "booking.confirmed") {
    return {
      patient: row.data.patient_name ?? "Caller",
      test: row.data.test_type ?? "—",
      summary:
        row.data.summary ??
        `Booked ${row.data.date} at ${row.data.time_slot} via ${row.channel}.`,
    };
  }
  if (row.type === "guardrail.redacted") {
    return {
      patient: `Caller ${phone}`,
      test: "—",
      summary:
        row.data.summary ??
        "PHI intercepted and redacted by the compliance layer before storage.",
    };
  }
  return {
    patient: `Caller ${phone}`,
    test: "—",
    summary: `Inbound ${row.channel} conversation answered by the AI.`,
  };
}

export default function CallLogsPage() {
  const { rows, source, loading } = useAuditTrail();
  const [filter, setFilter] = useState<FilterKey>("all");

  const visible = rows.filter((r) => filter === "all" || r.type === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">Call Logs</h1>
          <p className="mt-0.5 text-[12.5px] text-slate-500">
            {source === "supabase"
              ? "Durable audit trail · Supabase + Realtime"
              : "Live engine feed (in-memory) — connect Supabase for durable history"}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={
              filter === f.key
                ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-slate-50"
                : "rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[130px_160px_80px_150px_170px_minmax(160px,1fr)] gap-x-3 border-b border-slate-200 bg-slate-50 px-4.5 py-2">
          {["Time", "Patient", "Channel", "Requested Test", "Status", "AI Summary"].map(
            (h) => (
              <span
                key={h}
                className="text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                {h}
              </span>
            )
          )}
        </div>

        {loading ? (
          <div className="px-4.5 py-12 text-center text-sm text-slate-400">
            Loading audit trail…
          </div>
        ) : visible.length === 0 ? (
          <div className="px-4.5 py-12 text-center text-sm text-slate-400">
            No events match this filter yet.
          </div>
        ) : (
          visible.map((row) => {
            const d = describe(row);
            return (
              <div
                key={`${row.id}-${row.event_id}`}
                className={`grid grid-cols-[130px_160px_80px_150px_170px_minmax(160px,1fr)] items-center gap-x-3 border-b border-slate-100 px-4.5 py-2.5 ${
                  row.type === "guardrail.redacted" ? "bg-red-50/60" : ""
                }`}
              >
                <span className="font-mono text-[11.5px] text-slate-500">
                  {new Date(row.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[12.5px] font-semibold">
                    {d.patient}
                  </div>
                  <div className="font-mono text-[10.5px] text-slate-400">
                    {row.phone_tail ? `••• ${row.phone_tail}` : ""}
                  </div>
                </div>
                <span
                  className={
                    row.channel === "whatsapp"
                      ? "justify-self-start rounded-md bg-green-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-green-700"
                      : "justify-self-start rounded-md bg-indigo-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-indigo-700"
                  }
                >
                  {row.channel === "whatsapp" ? "WA" : "VOICE"}
                </span>
                <span className="truncate text-xs font-medium text-slate-700">
                  {d.test}
                </span>
                <div>
                  <StatusBadge kind={badgeKind(row)} />
                </div>
                <span className="min-w-0 truncate text-[11.5px] text-slate-500">
                  {d.summary}
                </span>
              </div>
            );
          })
        )}

        <div className="flex items-center justify-between bg-slate-50 px-4.5 py-2.5">
          <span className="font-mono text-[11px] text-slate-500">
            SHOWING {visible.length} EVENT{visible.length === 1 ? "" : "S"}
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            EVENT METADATA ONLY — NO CALLER CONTENT IS EVER LOGGED
          </span>
        </div>
      </section>
    </div>
  );
}
