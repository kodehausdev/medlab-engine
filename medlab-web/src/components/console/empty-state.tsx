import type { ReactNode } from "react";

// Shared illustrated empty state — was bare text ("No events yet…") on
// every panel that could be empty. Small ambient-orb motif, the same
// expanding-ring language as the AVA brand animation, recreated in CSS
// since that lives as a standalone HTML asset in animations/, not
// something importable into a React component.

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="relative grid size-14 flex-none place-items-center">
        <span className="absolute inset-0 rounded-full border border-indigo-300/60 dark:border-indigo-500/30 [animation:ring-out_2.4s_ease-out_infinite]" />
        <span
          className="absolute inset-0 rounded-full border border-indigo-300/60 dark:border-indigo-500/30 [animation:ring-out_2.4s_ease-out_infinite]"
          style={{ animationDelay: "1.2s" }}
        />
        <span className="relative grid size-8 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-blue-600 shadow-[0_0_20px_rgba(79,70,229,0.35)]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 2 6a2 2 0 0 1 2-2z" />
          </svg>
        </span>
      </div>
      <div className="text-[13px] font-semibold text-slate-600 dark:text-slate-300">{title}</div>
      {description ? (
        <div className="max-w-xs text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          {description}
        </div>
      ) : null}
      {action ?? null}
    </div>
  );
}
