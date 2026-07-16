// POST /api/team/invite  { email, role }
// Owner-only. Uses Supabase's own invite flow (creates the auth user +
// emails them a signup link) rather than generating a password ourselves —
// email delivery depends on the project's configured provider, same
// caveat as every other "PENDING" integration on the Compliance page.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/server/supabase-admin";
import { getCallerTenant } from "@/lib/server/session";

const VALID_ROLES = new Set(["owner", "staff"]);

export async function POST(req: Request) {
  const result = await getCallerTenant(req);
  if (!result.ok)
    return NextResponse.json({ error: result.error }, { status: result.status });
  if (result.caller.role !== "owner")
    return NextResponse.json({ error: "Only an owner can invite teammates." }, { status: 403 });

  let body: { email?: string; role?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  const role = body.role ?? "staff";
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  if (!VALID_ROLES.has(role))
    return NextResponse.json({ error: "Role must be 'owner' or 'staff'." }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    data: { invited_to_tenant: result.tenant.id },
  });
  if (inviteError || !invited?.user) {
    const exists = /already registered|already exists/i.test(inviteError?.message ?? "");
    return NextResponse.json(
      {
        error: exists
          ? "That email already has an account. Remove and re-invite isn't supported yet — check the team list."
          : `Could not send invite: ${inviteError?.message}`,
      },
      { status: exists ? 409 : 500 }
    );
  }

  const { error: profileError } = await admin.from("profiles").insert({
    user_id: invited.user.id,
    tenant_id: result.tenant.id,
    role,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(invited.user.id);
    return NextResponse.json(
      { error: `Could not link invited account: ${profileError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
