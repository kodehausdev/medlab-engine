"use client";

import { useMemo, useState } from "react";
import { useDashboard } from "@/components/console/dashboard-provider";
import { useAppointments, type Appointment } from "@/hooks/use-appointments";
import { useScheduleBlocks, type ScheduleBlock } from "@/hooks/use-schedule-blocks";
import { authHeaders, recoverFromExpiredSession } from "@/lib/auth-headers";

function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function addDays(dateStr: string, delta: number) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return toDateStr(dt);
}

function dateLabel(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const today = toDateStr(new Date());
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);
  const base = dt.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
  if (dateStr === today) return `${base} — Today`;
  if (dateStr === tomorrow) return `${base} — Tomorrow`;
  if (dateStr === yesterday) return `${base} — Yesterday`;
  return base;
}

function buildDaySlots(openHour: number, closeHour: number) {
  const slots: string[] = [];
  for (let h = openHour; h < closeHour; h++) {
    slots.push(`${String(h).padStart(2, "0")}:00`);
    slots.push(`${String(h).padStart(2, "0")}:30`);
  }
  return slots;
}

const RULES = [
  {
    t: "Slot capacity",
    d: "Never books more chairs than are physically available in a single 30-minute slot.",
  },
  {
    t: "Business hours only",
    d: "Only offers and accepts slots inside the lab's configured open/close hours.",
  },
  {
    t: "Test-catalog validation",
    d: "Only books recognized test types — unrecognized requests are clarified with the caller, never guessed.",
  },
  {
    t: "Real-time capacity check",
    d: "Checks live booking counts immediately before confirming, so two callers can never win the same chair.",
  },
  {
    t: "Blocked windows",
    d: "Never offers or accepts a slot the front desk has manually blocked — existing bookings in it are left alone.",
  },
];

export default function SchedulingPage() {
  const { tenant, status } = useDashboard();
  const [date, setDate] = useState(() => toDateStr(new Date()));
  const { appointments, source, loading } = useAppointments(date);
  const { blocks } = useScheduleBlocks(date);
  const [addSlot, setAddSlot] = useState<string | null>(null);

  const openHour = tenant?.open_hour ?? 8;
  const closeHour = tenant?.close_hour ?? 17;
  const capacity = tenant?.slot_capacity ?? 2;
  const slots = useMemo(() => buildDaySlots(openHour, closeHour), [openHour, closeHour]);

  const bySlot = useMemo(() => {
    const map = new Map<string, Appointment[]>();
    for (const a of appointments) {
      const list = map.get(a.time_slot) ?? [];
      list.push(a);
      map.set(a.time_slot, list);
    }
    return map;
  }, [appointments]);

  const blockBySlot = useMemo(() => {
    const map = new Map<string, ScheduleBlock>();
    for (const b of blocks) map.set(b.time_slot, b);
    return map;
  }, [blocks]);

  const gridCols = `70px repeat(${capacity},1fr) 118px`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[19px] font-bold tracking-tight">Scheduling</h1>
          <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
            {tenant ? tenant.lab_name : "connecting to engine…"} · {capacity} chair
            {capacity === 1 ? "" : "s"} · slots the AI can offer, live
            {source === "engine" ? " · (live feed only — today may be incomplete after a restart)" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setDate((d) => addDays(d, -1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Previous day"
          >
            ◀
          </button>
          <span className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
            {dateLabel(date)}
          </span>
          <button
            onClick={() => setDate((d) => addDays(d, 1))}
            className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="Next day"
          >
            ▶
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1 basis-[560px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
          <div
            className="grid gap-x-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-700 dark:bg-slate-800/50"
            style={{ gridTemplateColumns: gridCols }}
          >
            <span className="text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              Time
            </span>
            {Array.from({ length: capacity }, (_, i) => (
              <span
                key={i}
                className="text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400"
              >
                Chair {i + 1}
              </span>
            ))}
            <span className="text-right text-[10px] font-bold tracking-wider text-slate-500 uppercase dark:text-slate-400">
              AI Status
            </span>
          </div>

          {loading ? (
            <div className="px-4.5 py-12 text-center text-sm text-slate-400">
              Loading schedule…
            </div>
          ) : (
            slots.map((slot) => {
              const booked = bySlot.get(slot) ?? [];
              const open = capacity - booked.length;
              const block = blockBySlot.get(slot);
              return (
                <div
                  key={slot}
                  className="grid items-start gap-x-2.5 border-b border-slate-100 px-4 py-2 dark:border-slate-800"
                  style={{ gridTemplateColumns: gridCols }}
                >
                  <span className="pt-1.5 font-mono text-[11.5px] font-semibold text-slate-700 dark:text-slate-300">
                    {slot}
                  </span>
                  {Array.from({ length: capacity }, (_, i) => {
                    const appt = booked[i];
                    if (appt) {
                      return (
                        <div
                          key={i}
                          className="relative min-h-[34px] min-w-0 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 pr-5 dark:border-indigo-500/30 dark:bg-indigo-500/10"
                        >
                          <CancelApptButton id={appt.id} />
                          <div className="truncate text-[11px] font-semibold text-indigo-900 dark:text-indigo-200">
                            {appt.patient_name}
                            {appt.channel === "walk-in" ? (
                              <span className="ml-1 font-mono text-[9px] font-normal text-indigo-400 dark:text-indigo-400/70">
                                walk-in
                              </span>
                            ) : null}
                          </div>
                          <div className="truncate font-mono text-[9.5px] text-indigo-400 dark:text-indigo-400/80">
                            {appt.test_type}
                          </div>
                        </div>
                      );
                    }
                    if (addSlot === slot && i === booked.length) {
                      return (
                        <WalkInQuickAdd
                          key={i}
                          date={date}
                          timeSlot={slot}
                          onDone={() => setAddSlot(null)}
                        />
                      );
                    }
                    return (
                      <button
                        key={i}
                        onClick={() => setAddSlot(slot)}
                        className="min-h-[34px] min-w-0 rounded-lg border border-dashed border-slate-300 bg-white px-2.5 py-1.5 text-left text-[10.5px] font-medium text-slate-300 hover:border-indigo-300 hover:text-indigo-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-700 dark:hover:border-indigo-500/40 dark:hover:text-indigo-400"
                      >
                        + Walk-in
                      </button>
                    );
                  })}
                  <div className="justify-self-end text-right">
                    {block ? (
                      <>
                        <span className="inline-block rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
                          BLOCKED
                        </span>
                        {block.reason ? (
                          <div className="mt-0.5 max-w-[110px] truncate text-[9.5px] text-slate-400 dark:text-slate-500" title={block.reason}>
                            {block.reason}
                          </div>
                        ) : null}
                        <UnblockButton id={block.id} />
                      </>
                    ) : (
                      <>
                        <span
                          className={
                            open === 0
                              ? "inline-block rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300"
                              : open === capacity
                                ? "inline-block rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400"
                                : "inline-block rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-0.5 text-[10.5px] font-semibold whitespace-nowrap text-indigo-700 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-300"
                          }
                        >
                          {open === 0 ? "FULL" : open === capacity ? "OPEN" : `${open} OPEN`}
                        </span>
                        <BlockSlotButton date={date} timeSlot={slot} />
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div className="flex flex-wrap gap-3.5 bg-slate-50 px-4 py-2.5 dark:bg-slate-800/50">
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="size-2.5 rounded-[3px] border border-indigo-200 bg-indigo-50 dark:border-indigo-500/30 dark:bg-indigo-500/10" />
              Booked (AI or walk-in)
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="size-2.5 rounded-[3px] border border-dashed border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900" />
              Open
            </span>
            <span className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
              <span className="size-2.5 rounded-full border border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10" />
              Blocked
            </span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-3.5 md:w-[300px] md:flex-none">
          <section className="rounded-xl border border-indigo-200 bg-indigo-50 px-4.5 py-4 dark:border-indigo-500/30 dark:bg-indigo-500/10">
            <h2 className="mb-2 text-[13px] font-bold text-indigo-900 dark:text-indigo-200">
              Rules the AI enforces
            </h2>
            {RULES.map((r) => (
              <div key={r.t} className="border-t border-indigo-200/70 py-2 first:border-t-0 dark:border-indigo-500/20">
                <div className="text-xs font-bold text-indigo-900 dark:text-indigo-200">{r.t}</div>
                <div className="mt-0.5 text-[11.5px] leading-relaxed text-indigo-700 dark:text-indigo-300">
                  {r.d}
                </div>
              </div>
            ))}
          </section>
          {status === "engine-unlinked" || status === "offline" ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4.5 py-3.5 text-[11.5px] leading-relaxed text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              No live line connected yet — this grid will populate as soon as
              the AI receptionist is provisioned and starts taking calls.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function CancelApptButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/scheduling/holds", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ id }),
      });
      if (res.status === 401) return void recoverFromExpiredSession();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title="Cancel this appointment"
      className="absolute top-1 right-1 text-[11px] leading-none font-bold text-indigo-300 hover:text-red-600 disabled:opacity-40 dark:text-indigo-500/60 dark:hover:text-red-400"
    >
      ✕
    </button>
  );
}

function WalkInQuickAdd({
  date,
  timeSlot,
  onDone,
}: {
  date: string;
  timeSlot: string;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [testType, setTestType] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scheduling/holds", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          date,
          time_slot: timeSlot,
          patient_name: name.trim(),
          test_type: testType.trim(),
        }),
      });
      if (res.status === 401) return void recoverFromExpiredSession();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not add walk-in.");
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="flex min-w-0 flex-col gap-1 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/60 p-1.5 dark:border-indigo-500/40 dark:bg-indigo-500/10"
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Patient name"
        maxLength={120}
        className="w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      <input
        value={testType}
        onChange={(e) => setTestType(e.target.value)}
        placeholder="Test type"
        maxLength={120}
        className="w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-[11px] font-medium text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      {error ? (
        <div className="text-[9.5px] font-medium text-red-600 dark:text-red-400">{error}</div>
      ) : null}
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={busy || !name.trim() || !testType.trim()}
          className="flex-1 rounded bg-indigo-600 px-1.5 py-1 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Adding…" : "Add"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded px-1.5 py-1 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function BlockSlotButton({ date, timeSlot }: { date: string; timeSlot: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/scheduling/blocks", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ date, time_slot: timeSlot, reason: reason.trim() || undefined }),
      });
      if (res.status === 401) return void recoverFromExpiredSession();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not block slot.");
      setOpen(false);
      setReason("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-1 block w-full text-right text-[10px] font-semibold text-slate-300 hover:text-red-600 dark:text-slate-600 dark:hover:text-red-400"
      >
        Block
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="mt-1 flex flex-col items-end gap-1">
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional)"
        maxLength={200}
        className="w-[118px] min-w-0 rounded border border-slate-300 bg-white px-1.5 py-1 text-[10px] font-medium text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
      />
      {error ? (
        <div className="text-[9.5px] font-medium text-red-600 dark:text-red-400">{error}</div>
      ) : null}
      <div className="flex gap-1">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function UnblockButton({ id }: { id: number }) {
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const res = await fetch("/api/scheduling/blocks", {
        method: "DELETE",
        headers: await authHeaders(),
        body: JSON.stringify({ id }),
      });
      if (res.status === 401) return void recoverFromExpiredSession();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="mt-0.5 block w-full text-right text-[10px] font-semibold text-red-500 hover:text-red-700 disabled:opacity-40 dark:text-red-400 dark:hover:text-red-300"
    >
      {busy ? "…" : "Unblock"}
    </button>
  );
}
