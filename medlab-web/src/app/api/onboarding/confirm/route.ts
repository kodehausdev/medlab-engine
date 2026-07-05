// POST /api/onboarding/confirm  { session_id }
// Called by the success page after Stripe redirects back. Verifies the
// Checkout Session server-side (never trusts the redirect alone) and
// activates the tenant. Idempotent — safe to call on refresh.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { stripeClient } from "@/lib/server/stripe";

export async function POST(req: Request) {
  let sessionId: string | undefined;
  try {
    sessionId = (await req.json())?.session_id;
  } catch {
    /* fall through */
  }
  if (!sessionId)
    return NextResponse.json({ error: "session_id is required." }, { status: 400 });

  const stripe = stripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const tenantId = session.metadata?.tenant_id;
  if (!tenantId)
    return NextResponse.json({ error: "Unknown checkout session." }, { status: 404 });

  if (session.payment_status !== "paid") {
    return NextResponse.json(
      { error: "Payment not completed yet.", status: session.status },
      { status: 402 }
    );
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  const admin = supabaseAdmin();
  const { data: tenant, error } = await admin
    .from("tenants")
    .update({
      subscription_status: "active",
      stripe_subscription_id: subscriptionId,
    })
    .eq("id", tenantId)
    .select("id, lab_name, slot_capacity, open_hour, close_hour")
    .single();

  if (error || !tenant)
    return NextResponse.json(
      { error: `Activation failed: ${error?.message ?? "tenant missing"}` },
      { status: 500 }
    );

  return NextResponse.json({ tenant, status: "active" });
}
