"use client";

import { useAuditTrail } from "@/hooks/use-audit-trail";

const CONTROLS = [
  {
    name: "sanitizeAppointment()",
    desc: "Whitelist-only write path — the sole route to the database.",
  },
  {
    name: "guardToolArgs()",
    desc: "Every model tool call intercepted; unknown fields stripped, health content rejected.",
  },
  {
    name: "safeLog()",
    desc: "All runtime logs pass PHI redaction — SSNs, DOBs, member IDs, phone tails.",
  },
  {
    name: "Session TTL sweep",
    desc: "Conversation state is RAM-only, evicted after 15 idle minutes.",
  },
];

const BAAS = [
  { name: "Twilio (voice + WhatsApp)", state: "PENDING", ok: false },
  { name: "Hosting provider", state: "PENDING", ok: false },
  { name: "Model API (Vertex AI route)", state: "WIRED", ok: true },
  { name: "Tenant BAA (per lab)", state: "TEMPLATE", ok: false },
];

export default function CompliancePage() {
  const { rows, source } = useAuditTrail();
  const guardrails = rows.filter((r) => r.type === "guardrail.redacted");

  const kpis = [
    {
      label: "GUARDRAIL EVENTS",
      value: String(guardrails.length),
      sub: "all intercepted pre-storage",
      cls: "text-red-700",
    },
    {
      label: "FREE-TEXT PHI STORED",
      value: "0",
      sub: "whitelist-only writes",
      cls: "text-green-700",
    },
    {
      label: "FIELDS PER BOOKING",
      value: "4",
      sub: "name · phone · test · time",
      cls: "text-slate-900",
    },
    {
      label: "TRANSCRIPTS PERSISTED",
      value: "None",
      sub: "in-memory, 15-min TTL",
      cls: "text-green-700",
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">Compliance</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500">
          Guardrail audit trail · control posture · BAA status
          {source === "engine" ? " · (live feed — connect Supabase for durable history)" : ""}
        </p>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-sm"
          >
            <div className="font-mono text-[10px] font-semibold tracking-wider text-slate-500">
              {k.label}
            </div>
            <div className={`mt-1.5 text-2xl font-bold tracking-tight ${k.cls}`}>
              {k.value}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-400">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <section className="min-w-0 flex-1 basis-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center gap-2.5 border-b border-slate-200 px-4.5 py-3">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#b91c1c"
              strokeWidth="2.2"
              strokeLinecap="round"
            >
              <path d="M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5l8-3z" />
            </svg>
            <h2 className="text-[13.5px] font-bold">Guardrail audit trail</h2>
            <span className="ml-auto font-mono text-[10px] text-slate-400">
              EVENT METADATA ONLY — NO CALLER CONTENT
            </span>
          </div>

          {guardrails.length === 0 ? (
            <div className="px-4.5 py-10 text-center text-sm text-slate-400">
              No guardrail intercepts recorded. Prompt-level deflections are not
              yet surfaced here.
            </div>
          ) : (
            guardrails.map((row) => (
              <div
                key={`${row.id}-${row.event_id}`}
                className="flex items-start gap-3 border-b border-slate-100 px-4.5 py-3"
              >
                <span className="mt-0.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-red-700">
                  PHI redacted
                </span>
                <div className="min-w-0">
                  <div className="font-mono text-[11.5px] text-indigo-800">
                    {row.event_id} · {row.data.tool ?? "unknown tool"} ·{" "}
                    {row.channel} · ••• {row.phone_tail ?? "????"}
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-slate-500">
                    {row.data.summary ??
                      "Restricted content intercepted before execution — nothing stored."}
                  </div>
                </div>
                <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-slate-400">
                  {new Date(row.created_at).toLocaleString("en-US", {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </span>
              </div>
            ))
          )}
          <div className="bg-slate-50 px-4.5 py-2.5 font-mono text-[11px] text-slate-500">
            RETENTION: 6 YEARS · EXPORTS ARE PHI-FREE BY CONSTRUCTION
          </div>
        </section>

        <div className="flex w-80 flex-none flex-col gap-3.5">
          <section className="rounded-xl border border-slate-200 bg-white px-4.5 py-4 shadow-sm">
            <h2 className="mb-2 text-[13.5px] font-bold">Technical controls</h2>
            {CONTROLS.map((c) => (
              <div
                key={c.name}
                className="flex items-start gap-2.5 border-t border-slate-100 py-2"
              >
                <span className="mt-0.5 grid size-4 flex-none place-items-center rounded-full bg-green-100 text-[10px] font-bold text-green-700">
                  ✓
                </span>
                <div>
                  <div className="font-mono text-[11.5px] font-semibold">
                    {c.name}
                  </div>
                  <div className="mt-0.5 text-[11px] leading-snug text-slate-500">
                    {c.desc}
                  </div>
                </div>
              </div>
            ))}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white px-4.5 py-4 shadow-sm">
            <h2 className="mb-2 text-[13.5px] font-bold">BAA status</h2>
            {BAAS.map((b) => (
              <div
                key={b.name}
                className="flex items-center gap-2.5 border-t border-slate-100 py-2"
              >
                <span
                  className={
                    b.ok
                      ? "grid size-4 flex-none place-items-center rounded-full bg-green-100 text-[9px] font-bold text-green-700"
                      : "grid size-4 flex-none place-items-center rounded-full bg-amber-100 text-[9px] font-bold text-amber-700"
                  }
                >
                  {b.ok ? "✓" : "!"}
                </span>
                <span className="text-xs font-medium text-slate-700">
                  {b.name}
                </span>
                <span
                  className={
                    b.ok
                      ? "ml-auto font-mono text-[10px] font-semibold text-green-700"
                      : "ml-auto font-mono text-[10px] font-semibold text-amber-700"
                  }
                >
                  {b.state}
                </span>
              </div>
            ))}
            <p className="mt-2.5 text-[10.5px] leading-snug text-slate-400">
              Technical controls ≠ compliance. Signed BAAs across the stack land
              with the US entity registration.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
