"use client";

// Console chrome had no help/support affordance anywhere — for a HIPAA-
// adjacent product that matters for trust. Deliberately doesn't hardcode a
// support email: there wasn't one anywhere in this codebase already, and
// inventing one would present a fake contact channel as real. Configure
// NEXT_PUBLIC_SUPPORT_EMAIL to enable the mailto link; it degrades
// honestly (not silently) when unset.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const SUPPORT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;

const SHORTCUTS = [
  { keys: "Ctrl/⌘ K", label: "Search & jump to a page" },
  { keys: "Esc", label: "Close any open panel" },
];

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2-2.4 3.5" />
      <path d="M12 17.2h.01" />
    </svg>
  );
}

export function HelpMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        className="grid size-8 flex-none place-items-center rounded-full text-slate-300 hover:bg-slate-800 hover:text-white"
      >
        <HelpIcon />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute top-full right-0 z-50 mt-2 w-64 overflow-hidden rounded-lg border border-slate-200 bg-white py-1.5 text-slate-900 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
        >
          <div className="border-b border-slate-100 px-3.5 py-2.5 dark:border-slate-700">
            <div className="mb-1.5 font-mono text-[10px] font-semibold tracking-wider text-slate-400 uppercase dark:text-slate-500">
              Shortcuts
            </div>
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-3 py-0.5">
                <span className="text-[11.5px] text-slate-600 dark:text-slate-300">{s.label}</span>
                <kbd className="rounded border border-slate-300 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:border-slate-600 dark:text-slate-400">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>

          <Link
            href="/compliance"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Compliance & BAA status
          </Link>

          {SUPPORT_EMAIL ? (
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700"
            >
              Contact support → {SUPPORT_EMAIL}
            </a>
          ) : (
            <div className="px-3.5 py-2 text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              Support email not configured yet.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
