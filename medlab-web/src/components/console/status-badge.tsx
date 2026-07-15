import type { DashboardEvent } from "@/lib/engine";

const STYLES = {
  booked: {
    label: "Booked",
    cls: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dot: "bg-indigo-700",
  },
  cancelled: {
    label: "Cancelled",
    cls: "bg-amber-50 text-amber-700 border-amber-200",
    dot: "bg-amber-600",
  },
  guardrail: {
    label: "Guardrail Redacted",
    cls: "bg-red-50 text-red-700 border-red-200",
    dot: "bg-red-700",
  },
  emergency: {
    label: "Emergency Redirect",
    cls: "bg-red-100 text-red-800 border-red-300",
    dot: "bg-red-800",
  },
  optedOut: {
    label: "Opted Out",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-500",
  },
  optedIn: {
    label: "Opted In",
    cls: "bg-green-50 text-green-700 border-green-200",
    dot: "bg-green-600",
  },
  answered: {
    label: "Answered",
    cls: "bg-slate-100 text-slate-600 border-slate-200",
    dot: "bg-slate-500",
  },
} as const;

export function kindForEvent(ev: DashboardEvent): keyof typeof STYLES {
  if (ev.type === "booking.confirmed") return "booked";
  if (ev.type === "booking.cancelled") return "cancelled";
  if (ev.type === "guardrail.redacted") return "guardrail";
  if (ev.type === "emergency.detected") return "emergency";
  if (ev.type === "optout.received") return "optedOut";
  if (ev.type === "optout.restored") return "optedIn";
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
