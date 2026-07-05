import type { DashboardEvent } from "@/lib/engine";

const STYLES = {
  booked: {
    label: "Booked",
    cls: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-700",
  },
  guardrail: {
    label: "Guardrail Redacted",
    cls: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-700",
  },
  answered: {
    label: "Answered",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-500",
  },
} as const;

export function kindForEvent(ev: DashboardEvent): keyof typeof STYLES {
  if (ev.type === "booking.confirmed") return "booked";
  if (ev.type === "guardrail.redacted") return "guardrail";
  return "answered";
}

export function StatusBadge({ kind }: { kind: keyof typeof STYLES }) {
  const s = STYLES[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${s.cls}`}
    >
      <span className={`size-1.5 flex-none rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}
