// POST /api/scheduling/blocks   { date, time_slot, reason? }
// DELETE /api/scheduling/blocks { id }
//
// A block holds new capacity for a slot without touching whatever's already
// booked in it — medlab-engine's check_availability/book_appointment read
// this same table (schedule_blocks, migrations/0009) and stop offering or
// accepting the slot to the AI. Written here on the service-role key; the
// console reads it back directly via Supabase + RLS (use-schedule-blocks.ts),
// same pattern as appointments.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^([01]\d|2[0-3]):(00|30)$/;

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const date = typeof body.date === "string" ? body.date : "";
  const timeSlot = typeof body.time_slot === "string" ? body.time_slot : "";
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 200) : null;

  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "Invalid date. Expected YYYY-MM-DD." }, { status: 400 });
  if (!SLOT_RE.test(timeSlot))
    return NextResponse.json({ error: "Invalid time_slot. Expected HH:MM on a 30-minute boundary." }, { status: 400 });
  const hour = Number(timeSlot.slice(0, 2));
  if (hour < result.tenant.open_hour || hour >= result.tenant.close_hour)
    return NextResponse.json({ error: "That time is outside the lab's open hours." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data, error } = await admin
    .from("schedule_blocks")
    .upsert(
      {
        tenant_id: result.tenant.id,
        date,
        time_slot: timeSlot,
        reason: reason || null,
        created_by: result.caller.userId,
      },
      { onConflict: "tenant_id,date,time_slot" }
    )
    .select()
    .single();
  if (error)
    return NextResponse.json({ error: `Could not block slot: ${error.message}` }, { status: 500 });

  return NextResponse.json({ block: data });
}

export async function DELETE(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const id = Number(body.id);
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be a number." }, { status: 400 });

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("schedule_blocks")
    .delete()
    .eq("tenant_id", result.tenant.id)
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: `Could not unblock slot: ${error.message}` }, { status: 500 });

  return NextResponse.json({ ok: true });
}
