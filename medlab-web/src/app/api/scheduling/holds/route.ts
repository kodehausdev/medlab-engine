// POST /api/scheduling/holds   { date, time_slot, patient_name, test_type, phone_number? }
// DELETE /api/scheduling/holds { id }
//
// Walk-in holds are ordinary `appointments` rows with channel = 'walk-in',
// written directly by the console on the service-role key — the engine's
// countBookings/bookingsOn already include them with zero engine changes,
// so a walk-in the front desk checks in occupies a chair exactly like an
// AI-confirmed booking does. DELETE cancels any appointment in this tenant
// (walk-in or AI-booked) — releasing a hold or freeing up a slot manually
// is the same front-desk action either way.

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
  const patientName = typeof body.patient_name === "string" ? body.patient_name.trim() : "";
  const testType = typeof body.test_type === "string" ? body.test_type.trim() : "";
  const phoneNumber = typeof body.phone_number === "string" ? body.phone_number.trim() : "";

  if (!DATE_RE.test(date))
    return NextResponse.json({ error: "Invalid date. Expected YYYY-MM-DD." }, { status: 400 });
  if (!SLOT_RE.test(timeSlot))
    return NextResponse.json({ error: "Invalid time_slot. Expected HH:MM on a 30-minute boundary." }, { status: 400 });
  const hour = Number(timeSlot.slice(0, 2));
  if (hour < result.tenant.open_hour || hour >= result.tenant.close_hour)
    return NextResponse.json({ error: "That time is outside the lab's open hours." }, { status: 400 });
  if (!patientName || patientName.length > 120)
    return NextResponse.json({ error: "Patient name is required (max 120 characters)." }, { status: 400 });
  if (!testType || testType.length > 120)
    return NextResponse.json({ error: "Test type is required (max 120 characters)." }, { status: 400 });

  const admin = supabaseAdmin();

  const { count, error: countError } = await admin
    .from("appointments")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", result.tenant.id)
    .eq("date", date)
    .eq("time_slot", timeSlot)
    .eq("status", "confirmed");
  if (countError)
    return NextResponse.json({ error: `Could not check capacity: ${countError.message}` }, { status: 500 });
  if ((count ?? 0) >= result.tenant.slot_capacity)
    return NextResponse.json({ error: `The ${timeSlot} slot on ${date} is already full.` }, { status: 409 });

  const { data, error } = await admin
    .from("appointments")
    .insert([
      {
        tenant_id: result.tenant.id,
        patient_name: patientName,
        phone_number: phoneNumber,
        test_type: testType,
        date,
        time_slot: timeSlot,
        channel: "walk-in",
        status: "confirmed",
      },
    ])
    .select()
    .single();
  if (error)
    return NextResponse.json({ error: `Could not create hold: ${error.message}` }, { status: 500 });

  return NextResponse.json({ appointment: data });
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
  const { data, error } = await admin
    .from("appointments")
    .update({ status: "cancelled" })
    .eq("tenant_id", result.tenant.id)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error)
    return NextResponse.json({ error: `Could not cancel: ${error.message}` }, { status: 500 });
  if (!data)
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  return NextResponse.json({ ok: true });
}
