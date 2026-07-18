// POST /api/settings/update
//   { lab_name, timezone, open_hour, close_hour, slot_capacity,
//     test_catalog?, notify_email?, notify_sms_number? }
// Self-serve edit of the tenant-level fields that directly drive engine
// behavior: buildDaySlots/countBookings (hours, capacity), and now the
// per-tenant test catalog (schemas.js's buildFunctionDeclarations,
// handlers.js's catalogFor) and notification contacts (plumbing for the
// email/SMS emergency-paging follow-up — nothing reads these yet).

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";
import { US_TIMEZONE_VALUES } from "@/lib/timezones";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[1-9]\d{7,14}$/;

interface TestCatalogEntryInput {
  code: string;
  name: string;
  duration_min: number;
}

function parseTestCatalog(input: unknown): { ok: true; value: TestCatalogEntryInput[] | null } | { ok: false; error: string } {
  if (input == null) return { ok: true, value: null };
  if (!Array.isArray(input)) return { ok: false, error: "test_catalog must be a list." };
  if (input.length > 30) return { ok: false, error: "Test catalog is limited to 30 entries." };
  if (input.length === 0) return { ok: true, value: null };

  const seen = new Set<string>();
  const entries: TestCatalogEntryInput[] = [];
  for (const raw of input) {
    if (typeof raw !== "object" || raw === null)
      return { ok: false, error: "Each test catalog entry must be an object." };
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.trim() : "";
    const durationMin = Number(r.duration_min);
    if (!name || name.length > 120)
      return { ok: false, error: "Each test needs a name (max 120 characters)." };
    if (!Number.isInteger(durationMin) || durationMin < 1 || durationMin > 240)
      return { ok: false, error: `"${name}" needs a duration between 1 and 240 minutes.` };
    const code = (typeof r.code === "string" && r.code.trim()) || name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 40);
    if (seen.has(code)) return { ok: false, error: `Duplicate test code "${code}".` };
    seen.add(code);
    entries.push({ code, name, duration_min: durationMin });
  }
  return { ok: true, value: entries };
}

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.caller.role !== "owner")
    return NextResponse.json({ error: "Only an owner can change lab settings." }, { status: 403 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const labName = typeof body.lab_name === "string" ? body.lab_name.trim() : "";
  const timezone = typeof body.timezone === "string" ? body.timezone : "";
  const openHour = Number(body.open_hour);
  const closeHour = Number(body.close_hour);
  const slotCapacity = Number(body.slot_capacity);
  const notifyEmail = typeof body.notify_email === "string" ? body.notify_email.trim() : "";
  const notifySmsNumber = typeof body.notify_sms_number === "string" ? body.notify_sms_number.trim() : "";

  if (!labName || labName.length > 120)
    return NextResponse.json({ error: "Lab name is required (max 120 characters)." }, { status: 400 });
  if (!US_TIMEZONE_VALUES.includes(timezone as (typeof US_TIMEZONE_VALUES)[number]))
    return NextResponse.json({ error: "Unrecognized timezone." }, { status: 400 });
  if (!Number.isInteger(openHour) || !Number.isInteger(closeHour) || openHour < 0 || closeHour > 23 || openHour >= closeHour)
    return NextResponse.json({ error: "Open hour must be before close hour, both within 0–23." }, { status: 400 });
  if (!Number.isInteger(slotCapacity) || slotCapacity < 1 || slotCapacity > 20)
    return NextResponse.json({ error: "Chairs per slot must be between 1 and 20." }, { status: 400 });
  if (notifyEmail && !EMAIL_RE.test(notifyEmail))
    return NextResponse.json({ error: "Notification email doesn't look valid." }, { status: 400 });
  if (notifySmsNumber && !PHONE_RE.test(notifySmsNumber))
    return NextResponse.json({ error: "Notification SMS number doesn't look valid — use E.164, e.g. +15551234567." }, { status: 400 });

  const catalogResult = parseTestCatalog(body.test_catalog);
  if (!catalogResult.ok)
    return NextResponse.json({ error: catalogResult.error }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({
      lab_name: labName,
      timezone,
      open_hour: openHour,
      close_hour: closeHour,
      slot_capacity: slotCapacity,
      test_catalog: catalogResult.value,
      notify_email: notifyEmail || null,
      notify_sms_number: notifySmsNumber || null,
    })
    .eq("id", result.tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not save settings: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
