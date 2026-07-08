// Resolves a signed-in caller's tenant from their Supabase access token.
// Service-role, bypasses RLS — mirrors medlab-engine's dashboardAuth.js
// token→tenant resolution, for Next.js route handlers. Onboarding routes
// use this instead of trusting a client-supplied tenant id.

import "server-only";
import { supabaseAdmin } from "./supabase-admin";

export interface CallerTenant {
  id: string;
  lab_name: string;
  stripe_customer_id: string | null;
  stripe_payment_method_id: string | null;
  onboarding_state: string;
  subscription_status: string;
  whatsapp_number: string | null;
}

export type CallerResult =
  | { ok: true; tenant: CallerTenant }
  | { ok: false; status: number; error: string };

export async function getCallerTenant(req: Request): Promise<CallerResult> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return { ok: false, status: 401, error: "Missing bearer token." };

  const admin = supabaseAdmin();
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user)
    return { ok: false, status: 401, error: "Invalid or expired session." };

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("tenant_id")
    .eq("user_id", userData.user.id)
    .single();
  if (profileError || !profile)
    return { ok: false, status: 403, error: "No tenant linked to this account." };

  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .select(
      "id, lab_name, stripe_customer_id, stripe_payment_method_id, onboarding_state, subscription_status, whatsapp_number"
    )
    .eq("id", profile.tenant_id)
    .single();
  if (tenantError || !tenant)
    return { ok: false, status: 404, error: "Tenant not found." };

  return { ok: true, tenant: tenant as CallerTenant };
}
