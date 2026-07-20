// One-time (idempotent) setup for the sunrise-demo public sales demo line.
// Never enters the billing state machine — no Stripe customer is ever
// created for it, so it's naturally excluded from MRR/analytics (those
// already filter on stripe_customer_id being set).
//
//   node scripts/seed-demo-tenant.mjs
//
// Re-run any time to pick up edits to the prompt file or the hours/capacity
// below — it upserts by tenant id, so it's safe to run repeatedly.
//
// Uses the service-role key from ../.env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(root);
const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);

if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const promptPath = join(repoRoot, "sales", "kesa-demo-tenant-system-prompt.md");
let promptSource;
try {
  promptSource = readFileSync(promptPath, "utf8");
} catch {
  console.error(`Couldn't read ${promptPath} — run this from a checkout that has sales/ in it.`);
  process.exit(1);
}
const promptMatch = promptSource.match(/## The prompt\s*\n```\n([\s\S]*?)\n```/);
if (!promptMatch) {
  console.error(`Couldn't find the fenced prompt block in ${promptPath} — did its structure change?`);
  process.exit(1);
}
const systemPromptOverride = promptMatch[1].trim();

// Must match services/leads.js's DEMO_TEST_NAME in medlab-engine exactly —
// there's no shared package between the two apps, so this is duplicated
// deliberately rather than silently drifting.
const DEMO_TEST_NAME = "15-minute product demo with Amanda";

// Amanda's availability, maintained by hand for now (per CLAUDE.md's spec)
// — adjust here and re-run, or block specific slots later from the console's
// Scheduling grid once this tenant is seeded.
const AMANDA_HOURS = { open: 9, close: 17, timezone: "America/New_York" };

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { error } = await admin.from("tenants").upsert(
  {
    id: "sunrise-demo",
    lab_name: "Sunrise Diagnostics",
    timezone: AMANDA_HOURS.timezone,
    open_hour: AMANDA_HOURS.open,
    close_hour: AMANDA_HOURS.close,
    slot_capacity: 1, // one demo slot at a time — it's Amanda's own calendar
    test_catalog: [{ code: "PRODUCT_DEMO", name: DEMO_TEST_NAME, duration_min: 15 }],
    system_prompt_override: systemPromptOverride,
    is_demo_tenant: true,
    onboarding_state: "live_active", // bypass the billing gate — never charged
  },
  { onConflict: "id" }
);
if (error) {
  console.error(`Seeding sunrise-demo failed: ${error.message}`);
  process.exit(1);
}

console.log("sunrise-demo is seeded.");
console.log(`  hours: ${AMANDA_HOURS.open}:00–${AMANDA_HOURS.close}:00 ${AMANDA_HOURS.timezone}`);
console.log(`  prompt: ${systemPromptOverride.length} chars from ${promptPath}`);
console.log("  Still needed: a real Twilio number pointed at this engine, with");
console.log("  tenants.twilio_number/whatsapp_number set to it — same manual step");
console.log("  as any other tenant's provisioning_active stage.");
