import type { ReactNode } from "react";

export function KpiCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4.5 py-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-slate-500">
          {label}
        </span>
        {icon}
      </div>
      <div className="mt-2 text-[32px] font-bold leading-none tracking-tight tabular-nums">
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-xs text-slate-600">{sub}</div> : null}
    </div>
  );
}
