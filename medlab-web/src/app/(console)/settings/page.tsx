"use client";

import { useState } from "react";
import { useAuth, type AuthTenant } from "@/components/auth/auth-gate";
import { authHeaders, recoverFromExpiredSession } from "@/lib/auth-headers";
import { US_TIMEZONES } from "@/lib/timezones";
import type { TestCatalogEntry } from "@/lib/engine";

const HOURS = Array.from({ length: 24 }, (_, h) => h);

// Display-only mirror of medlab-engine/src/services/tools/schemas.js's
// DEFAULT_TEST_CATALOG — seeds the editor when a lab customizes its catalog
// for the first time, so they're editing the real defaults, not starting
// from a blank list they'd have to reconstruct from memory.
const DEFAULT_TEST_CATALOG: TestCatalogEntry[] = [
  { code: "BLOOD_DRAW", name: "Blood Draw", duration_min: 15 },
  { code: "LIPID_PANEL", name: "Lipid Panel", duration_min: 15 },
  { code: "PCR_SCAN", name: "PCR Scan", duration_min: 20 },
  { code: "CBC", name: "Complete Blood Count (CBC)", duration_min: 15 },
  { code: "A1C", name: "Hemoglobin A1C", duration_min: 15 },
  { code: "URINALYSIS", name: "Urinalysis", duration_min: 10 },
];

function hourLabel(h: number) {
  const period = h < 12 ? "AM" : "PM";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}:00 ${period}`;
}

function codeFromName(name: string) {
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
}

export default function SettingsPage() {
  const { user, tenant, role, refreshTenant } = useAuth();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[19px] font-bold tracking-tight">Settings</h1>
        <p className="mt-0.5 text-[12.5px] text-slate-500 dark:text-slate-400">
          Lab identity and the hours/capacity the AI receptionist schedules against.
        </p>
      </div>

      {!user || !tenant ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-4.5 py-10 text-center text-sm text-slate-400 dark:border-slate-700 dark:bg-slate-900/60">
          Sign in to a provisioned lab account to edit settings.
        </div>
      ) : role === "owner" ? (
        // Keyed by tenant.id so the form's local state initializes fresh
        // from props on mount instead of syncing via an effect.
        <SettingsForm key={tenant.id} tenant={tenant} onSaved={refreshTenant} />
      ) : (
        <SettingsReadOnly tenant={tenant} />
      )}
    </div>
  );
}

function SettingsReadOnly({ tenant }: { tenant: AuthTenant }) {
  const tz = US_TIMEZONES.find((t) => t.value === tenant.timezone)?.label ?? tenant.timezone ?? "—";
  const catalogCount = tenant.test_catalog?.length ?? DEFAULT_TEST_CATALOG.length;
  const rows = [
    ["Lab name", tenant.lab_name],
    ["Timezone", tz],
    ["Hours", `${hourLabel(tenant.open_hour)} – ${hourLabel(tenant.close_hour)}`],
    ["Chairs per slot", String(tenant.slot_capacity)],
    ["Test catalog", `${catalogCount} test${catalogCount === 1 ? "" : "s"}${tenant.test_catalog?.length ? "" : " (default)"}`],
    ["Notify email", tenant.notify_email || "—"],
    ["Notify SMS", tenant.notify_sms_number || "—"],
  ];
  return (
    <div className="max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
        Only an owner can change lab settings — you have read-only access.
      </div>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between border-t border-slate-100 py-2.5 first:border-t-0 dark:border-slate-800">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{label}</span>
          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{value}</span>
        </div>
      ))}
    </div>
  );
}

function SettingsForm({
  tenant,
  onSaved,
}: {
  tenant: AuthTenant;
  onSaved: () => Promise<void>;
}) {
  const initialTimezone = tenant.timezone ?? US_TIMEZONES[0].value;
  const [labName, setLabName] = useState(tenant.lab_name);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [openHour, setOpenHour] = useState(tenant.open_hour);
  const [closeHour, setCloseHour] = useState(tenant.close_hour);
  const [slotCapacity, setSlotCapacity] = useState(tenant.slot_capacity);
  const [catalog, setCatalog] = useState<TestCatalogEntry[] | null>(tenant.test_catalog ?? null);
  const [newTestName, setNewTestName] = useState("");
  const [newTestDuration, setNewTestDuration] = useState(15);
  const [notifyEmail, setNotifyEmail] = useState(tenant.notify_email ?? "");
  const [notifySmsNumber, setNotifySmsNumber] = useState(tenant.notify_sms_number ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const initialCatalogKey = JSON.stringify(tenant.test_catalog?.length ? tenant.test_catalog : null);
  const catalogKey = JSON.stringify(catalog?.length ? catalog : null);

  const dirty =
    labName !== tenant.lab_name ||
    timezone !== initialTimezone ||
    openHour !== tenant.open_hour ||
    closeHour !== tenant.close_hour ||
    slotCapacity !== tenant.slot_capacity ||
    catalogKey !== initialCatalogKey ||
    notifyEmail !== (tenant.notify_email ?? "") ||
    notifySmsNumber !== (tenant.notify_sms_number ?? "");

  function addTest() {
    const name = newTestName.trim();
    if (!name) return;
    const base = catalog ?? [];
    setCatalog([...base, { code: codeFromName(name), name, duration_min: newTestDuration }]);
    setNewTestName("");
    setNewTestDuration(15);
  }

  function removeTest(code: string) {
    setCatalog((prev) => (prev ?? []).filter((t) => t.code !== code));
  }

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/update", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          lab_name: labName,
          timezone,
          open_hour: openHour,
          close_hour: closeHour,
          slot_capacity: slotCapacity,
          test_catalog: catalog?.length ? catalog : null,
          notify_email: notifyEmail.trim(),
          notify_sms_number: notifySmsNumber.trim(),
        }),
      });
      if (res.status === 401) return void recoverFromExpiredSession();
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not save settings.");
      await onSaved();
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Lab name
          <input
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            maxLength={120}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          />
        </label>

        <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Timezone
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          >
            {US_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </label>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Opens at
            <select
              value={openHour}
              onChange={(e) => setOpenHour(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Closes at
            <select
              value={closeHour}
              onChange={(e) => setCloseHour(Number(e.target.value))}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            >
              {HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="mt-4 block text-xs font-semibold text-slate-600 dark:text-slate-400">
          Chairs per slot
          <input
            type="number"
            min={1}
            max={20}
            value={slotCapacity}
            onChange={(e) => setSlotCapacity(Number(e.target.value))}
            className="mt-1.5 w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
          />
          <span className="mt-1 block text-[11px] font-normal text-slate-400 dark:text-slate-500">
            How many patients the AI can book into the same 30-minute slot — drives the Scheduling grid directly.
          </span>
        </label>
      </div>

      <div className="mt-4 max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100">Test catalog</h2>
        <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          What the AI will offer and accept as a test type. Leave uncustomized to use the built-in default six.
        </p>

        {catalog === null ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-dashed border-slate-300 px-3 py-2.5 dark:border-slate-700">
            <span className="text-[11.5px] text-slate-500 dark:text-slate-400">
              Using the default {DEFAULT_TEST_CATALOG.length} tests (Blood Draw, Lipid Panel, PCR Scan…).
            </span>
            <button
              type="button"
              onClick={() => setCatalog(DEFAULT_TEST_CATALOG.map((t) => ({ ...t })))}
              className="flex-none rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Customize
            </button>
          </div>
        ) : (
          <>
            {catalog.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                No tests left — the AI won&apos;t be able to book anything until you add at least one.
              </div>
            ) : (
              <div className="mt-3 flex flex-col gap-1.5">
                {catalog.map((t) => (
                  <div
                    key={t.code}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/60"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12.5px] font-semibold text-slate-800 dark:text-slate-200">{t.name}</div>
                      <div className="font-mono text-[10px] text-slate-400 dark:text-slate-500">
                        {t.duration_min} min · {t.code}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeTest(t.code)}
                      className="flex-none text-xs font-semibold text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="flex-1 basis-40 text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Test name
                <input
                  value={newTestName}
                  onChange={(e) => setNewTestName(e.target.value)}
                  placeholder="e.g. Thyroid Panel"
                  maxLength={120}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
              <label className="w-24 flex-none text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Minutes
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={newTestDuration}
                  onChange={(e) => setNewTestDuration(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-900 outline-none focus:border-indigo-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                />
              </label>
              <button
                type="button"
                onClick={addTest}
                disabled={!newTestName.trim()}
                className="flex-none rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                Add test
              </button>
            </div>
            <button
              type="button"
              onClick={() => setCatalog(null)}
              className="mt-2 text-[11px] font-semibold text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
            >
              Reset to default catalog
            </button>
          </>
        )}
      </div>

      <div className="mt-4 max-w-[560px] rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:shadow-none">
        <h2 className="text-xs font-bold text-slate-900 dark:text-slate-100">Notification contacts</h2>
        <p className="mt-0.5 text-[11.5px] text-slate-500 dark:text-slate-400">
          Where emergency redirects should page — the sending side isn&apos;t wired up yet, so these are saved for when it is.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            Email
            <input
              type="email"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              placeholder="frontdesk@lab.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            />
          </label>
          <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
            SMS number
            <input
              type="tel"
              value={notifySmsNumber}
              onChange={(e) => setNotifySmsNumber(e.target.value)}
              placeholder="+15551234567"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:focus:ring-indigo-500/20"
            />
          </label>
        </div>
      </div>

      {error ? (
        <div className="mt-4 max-w-[560px] rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
          {error}
        </div>
      ) : null}
      {saved && !dirty ? (
        <div className="mt-4 max-w-[560px] rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300">
          Saved.
        </div>
      ) : null}

      <button
        onClick={() => void onSave()}
        disabled={!dirty || busy || openHour >= closeHour || catalog?.length === 0}
        className="mt-5 rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
      >
        {busy ? "Saving…" : "Save changes"}
      </button>
    </>
  );
}
