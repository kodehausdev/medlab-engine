// POST /api/scheduling/attendance { id, status: 'completed' | 'no_show' | 'confirmed' }
//
// Front-desk attendance marking: moves a past booking confirmed → completed
// (patient showed) or no_show (they didn't), from the Scheduling grid.
// 'confirmed' is allowed as a target to undo a misclick. This is the ONLY
// thing that ever sets completed/no_show — the engine never guesses
// attendance, and reminders/no-show analytics are meaningless without it.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const ALLOWED = new Set(["completed", "no_show", "confirmed"]);

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

  const id = Number(body.id);
  const status = typeof body.status === "string" ? body.status : "";
  if (!Number.isInteger(id))
    return NextResponse.json({ error: "id must be a number." }, { status: 400 });
  if (!ALLOWED.has(status))
    return NextResponse.json(
      { error: "status must be completed, no_show, or confirmed." },
      { status: 400 }
    );

  const admin = supabaseAdmin();
  const { data: appt, error: fetchError } = await admin
    .from("appointments")
    .select("id, status, date")
    .eq("tenant_id", result.tenant.id)
    .eq("id", id)
    .maybeSingle();
  if (fetchError)
    return NextResponse.json({ error: `Lookup failed: ${fetchError.message}` }, { status: 500 });
  if (!appt)
    return NextResponse.json({ error: "Appointment not found." }, { status: 404 });

  // Never resurrect a cancelled booking, and don't mark attendance on a
  // future date — the slot hasn't happened yet.
  if (appt.status === "cancelled")
    return NextResponse.json({ error: "Cancelled appointments can't be marked." }, { status: 409 });
  const today = new Date().toISOString().split("T")[0];
  if (status !== "confirmed" && appt.date > today)
    return NextResponse.json(
      { error: "Attendance can only be marked once the appointment date arrives." },
      { status: 409 }
    );

  const { data, error } = await admin
    .from("appointments")
    .update({ status })
    .eq("tenant_id", result.tenant.id)
    .eq("id", id)
    .select()
    .single();
  if (error)
    return NextResponse.json({ error: `Update failed: ${error.message}` }, { status: 500 });

  return NextResponse.json({ appointment: data });
}
