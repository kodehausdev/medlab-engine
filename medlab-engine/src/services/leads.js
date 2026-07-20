// sunrise-demo lead capture. A demo-tenant conversation is classified — from
// deterministic session state, never from asking the model to self-report
// intent — into one of three outcomes when it ends, and (for the two
// meaningful outcomes) written into Mission Control's `leads` table.
//
// Deliberately NOT hooked directly into book_appointment: classification
// happens once, uniformly, at the moment a session actually ends (explicit
// end() or the idle TTL sweep) — see core/engine.js. That's the only point
// a conversation's *final* shape is known, and it means a silent hangup
// (no goodbye said) still gets captured correctly by the sweep path instead
// of never being observed at all.

const { safeLog } = require('../compliance/hipaa');

// Must match the `name` on the demo tenant's test_catalog entry exactly —
// see medlab-web/scripts/seed-demo-tenant.mjs.
const DEMO_TEST_NAME = '15-minute product demo with Amanda';

// Below this many history entries, a session is "picked up and immediately
// hung up" — not a real signal worth a lead row. One real exchange is a
// user turn + a model turn, i.e. 2 entries.
const MIN_MEANINGFUL_HISTORY = 2;

/**
 * classifyDemoOutcome(session) → 'booked_demo' | 'tested_only' | 'requested_info' | null
 * null means: don't log anything, there's no real signal here.
 */
function classifyDemoOutcome(session) {
  if (!session) return null;
  if (session.completed && session.facts?.test_type) {
    return session.facts.test_type === DEMO_TEST_NAME ? 'booked_demo' : 'tested_only';
  }
  if ((session.history?.length || 0) >= MIN_MEANINGFUL_HISTORY) return 'requested_info';
  return null;
}

function phoneTail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : '????';
}

const OUTCOME_NOTE = {
  booked_demo: 'Booked a product demo via the sunrise-demo phone line.',
  tested_only: 'Called the sunrise-demo line and booked a test appointment ' +
    'to try the flow, but did not book time with Amanda.',
  requested_info: 'Called the sunrise-demo line and asked questions, but ' +
    'did not book anything.',
};

/**
 * captureDemoLead(store, tenant, session) — best-effort, fire-and-forget.
 * Only 'booked_demo' and 'tested_only'/'requested_info' with real content
 * reach here; classifyDemoOutcome's null case is filtered by the caller.
 * A capture failure must never affect the caller's own conversation — by
 * the time this runs, the call/text has already ended.
 */
async function captureDemoLead(store, tenant, session) {
  const outcome = classifyDemoOutcome(session);
  if (!outcome) return;

  const phone = (session.from || '').replace(/^whatsapp:/, '').trim();
  const record = {
    business: `Inbound demo call (…${phoneTail(phone)})`,
    phone: phone || null,
    stage: outcome === 'booked_demo' ? 'demo_scheduled' : 'new',
    note: `${OUTCOME_NOTE[outcome]} [outcome: ${outcome}]`,
    // Approximate, not timezone-converted (there's no tenant-timezone context
    // at this layer) — good enough for Amanda's own follow-up reminder, not
    // used for anything scheduling-critical.
    next_at: outcome === 'booked_demo' && session.facts?.date && session.facts?.time_slot
      ? new Date(`${session.facts.date}T${session.facts.time_slot}:00`).toISOString()
      : null,
  };

  try {
    await store.insertLead(record);
    safeLog(`📋 [sunrise-demo] lead captured: ${outcome} [${tenant.id}]`);
  } catch (err) {
    safeLog(`⚠️ [sunrise-demo] lead capture failed: ${err.message}`);
  }
}

module.exports = { classifyDemoOutcome, captureDemoLead, DEMO_TEST_NAME };
