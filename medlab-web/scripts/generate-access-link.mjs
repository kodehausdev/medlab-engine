// One-off: generate a real Supabase invite/access link for a teammate
// without going through the (currently broken) Resend email send. Mirrors
// the invite/fallback logic in src/app/api/team/invite/route.ts, but prints
// the action_link instead of emailing it, so it can be sent manually.
//
//   node scripts/generate-access-link.mjs <lab_name> <email> <owner|staff>
//
// Uses the service-role key from ../.env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

const [labName, emailArg, roleArg] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const role = roleArg ?? "staff";
if (!labName || !email) {
  console.error("usage: node scripts/generate-access-link.mjs <lab_name> <email> <owner|staff>");
  process.exit(1);
}
if (!["owner", "staff"].includes(role)) {
  console.error("role must be 'owner' or 'staff'");
  process.exit(1);
}
if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: tenant, error: tenantError } = await admin
  .from("tenants")
  .select("id, lab_name")
  .ilike("lab_name", labName)
  .single();
if (tenantError || !tenant) {
  console.error(`tenant matching "${labName}" not found: ${tenantError?.message ?? "no rows"}`);
  process.exit(1);
}

const redirectTo = `https://medlab-web-murex.vercel.app/accept-invite`;

let userId = null;
let actionLink = null;
let kind = "invite";

const { data: inviteLink, error: inviteError } = await admin.auth.admin.generateLink({
  type: "invite",
  email,
  options: { redirectTo },
});

if (inviteLink?.user) {
  userId = inviteLink.user.id;
  actionLink = inviteLink.properties.action_link;
} else {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  userId = list?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
  if (!userId) {
    console.error(`could not create or find account for ${email}: ${inviteError?.message}`);
    process.exit(1);
  }
  const { data: recoveryLink, error: recoveryError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo },
  });
  if (recoveryError || !recoveryLink) {
    console.error(`could not generate access link: ${recoveryError?.message}`);
    process.exit(1);
  }
  actionLink = recoveryLink.properties.action_link;
  kind = "recovery";
}

const { error: profileError } = await admin
  .from("profiles")
  .upsert({ user_id: userId, tenant_id: tenant.id, role });
if (profileError) {
  console.error(`link generated but profile link failed: ${profileError.message}`);
  process.exit(1);
}

console.log(`tenant: ${tenant.lab_name} (${tenant.id})`);
console.log(`email:  ${email}`);
console.log(`role:   ${role}`);
console.log(`kind:   ${kind}`);
console.log(`link:   ${actionLink}`);
