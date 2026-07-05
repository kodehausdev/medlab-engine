"use client";

import { KpiCard } from "@/components/console/kpi-card";
import { LiveFeed } from "@/components/console/live-feed";
import { useDashboard } from "@/components/console/dashboard-provider";

const AVG_MINUTES_SAVED_PER_CALL = 4.2;

export default function OverviewPage() {
  const { connected, tenant, counters } = useDashboard();

  const hoursSaved = (counters.calls_answered * AVG_MINUTES_SAVED_PER_CALL) / 60;
  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[21px] font-bold tracking-tight">
            Front-Desk Operations
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {today}
            {tenant
              ? ` · ${tenant.lab_name} · ${tenant.slot_capacity} chairs per slot`
              : " · connecting to engine…"}
          </p>
        </div>
        <span className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500">
          Plan: Pro — $297/mo
        </span>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-3.5">
        <KpiCard
          label="Total Calls Answered"
          value={counters.calls_answered}
          sub={
            connected ? (
              <>Every inbound conversation, voice + WhatsApp</>
            ) : (
              "—"
            )
          }
        />
        <KpiCard
          label="Appointments Booked"
          value={counters.bookings_confirmed}
          sub="Confirmed by the AI against live capacity"
        />
        <KpiCard
          label="Front-Desk Hours Saved"
          value={
            <>
              {hoursSaved.toFixed(1)}{" "}
              <span className="text-base font-semibold text-slate-500">
                hrs
              </span>
            </>
          }
          sub={`≈ ${AVG_MINUTES_SAVED_PER_CALL} min staff time per call handled`}
        />
        <div className="rounded-xl border border-green-200 bg-gradient-to-b from-green-50 to-white px-4.5 py-4 shadow-sm">
          <div className="text-[11.5px] font-semibold uppercase tracking-wider text-green-700">
            Compliance Status
          </div>
          <div className="mt-2.5 text-xl font-bold tracking-tight text-green-950">
            {counters.guardrail_events === 0
              ? "100% PHI-Sanitized"
              : `${counters.guardrail_events} guardrail intercept${
                  counters.guardrail_events === 1 ? "" : "s"
                }`}
          </div>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-green-300 bg-green-100 px-2.5 py-1">
            <span className="size-1.5 rounded-full bg-green-600" />
            <span className="font-mono text-[11px] font-semibold text-green-800">
              HIPAA GUARDRAILS ACTIVE
            </span>
          </div>
        </div>
      </div>

      <LiveFeed />
    </div>
  );
}
