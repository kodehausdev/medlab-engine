// POST /api/onboarding/whatsapp-number  { whatsapp_number }
// Self-serve number intake, rendered by <NumberIntake> while the tenant is
// 'provisioning_pending_number'. Advances to 'provisioning_active' — ops
// then configures Twilio + the engine for this tenant out of band, and
// runs scripts/activate-tenant.mjs once it's live.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const E164_RE = /^\+[1-9]\d{7,14}$/;

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });

  const { tenant } = result;
  if (tenant.onboarding_state !== "provisioning_pending_number")
    return NextResponse.json(
      { error: `Tenant isn't awaiting a number (${tenant.onboarding_state}).` },
      { status: 409 }
    );

  let whatsappNumber: string | undefined;
  try {
    whatsappNumber = (await req.json())?.whatsapp_number;
  } catch {
    /* fall through */
  }
  whatsappNumber = whatsappNumber?.trim();
  if (!whatsappNumber || !E164_RE.test(whatsappNumber))
    return NextResponse.json(
      { error: "Enter the number in international format, e.g. +14155551234." },
      { status: 400 }
    );

  const admin = supabaseAdmin();
  const { error } = await admin
    .from("tenants")
    .update({ whatsapp_number: whatsappNumber, onboarding_state: "provisioning_active" })
    .eq("id", tenant.id);
  if (error)
    return NextResponse.json({ error: `Could not save number: ${error.message}` }, { status: 500 });

  return NextResponse.json({ onboarding_state: "provisioning_active" });
}
