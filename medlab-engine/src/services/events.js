// Dashboard event bus. The engine emits a small, PHI-minimized event stream
// that the front-desk console consumes over SSE (see routes/dashboard.js).
//
// Envelope (every event):
//   {
//     id: "evt-7",                     // monotonic per process, usable as SSE id
//     type: "call.answered" | "booking.confirmed" | "guardrail.redacted",
//     ts: "2026-07-04T15:42:00.000Z",
//     tenant_id: "default",
//     channel: "voice" | "whatsapp" | "unknown",
//     phone_tail: "4567",              // last 4 digits only — never the full number
//     data: { ... }                    // type-specific, passed through redactObject
//   }
//
// data by type:
//   call.answered      → {}
//   booking.confirmed  → { booking_id, patient_name, test_type, date, time_slot,
//                          status: "confirmed", summary }
//   guardrail.redacted → { tool, code, status: "guardrail_redacted", summary }
//     Deliberately carries NO caller content and NO matched health-history term —
//     only the fact that the compliance layer intercepted something.

const { redactObject } = require('../compliance/redact');

function phoneTail(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  return digits ? digits.slice(-4) : null;
}

function emptyCounters() {
  return { calls_answered: 0, bookings_confirmed: 0, guardrail_events: 0 };
}

function createEventBus({ tenant, bufferSize = 50 } = {}) {
  const subscribers = new Set();
  const recent = []; // ring buffer replayed to freshly connected dashboards
  const globalCounters = emptyCounters();
  const countersByTenant = new Map(); // tenant_id → counters
  let seq = 0;

  function emit(type, { channel, phone, tenantId } = {}, data = {}) {
    const event = {
      id: `evt-${++seq}`,
      type,
      ts: new Date().toISOString(),
      tenant_id: tenantId || tenant?.id || 'default',
      channel: channel || 'unknown',
      phone_tail: phoneTail(phone),
      data: redactObject(data), // defense in depth; payloads are already whitelisted
    };

    let scoped = countersByTenant.get(event.tenant_id);
    if (!scoped) {
      scoped = emptyCounters();
      countersByTenant.set(event.tenant_id, scoped);
    }
    for (const counters of [globalCounters, scoped]) {
      if (type === 'call.answered') counters.calls_answered++;
      else if (type === 'booking.confirmed') counters.bookings_confirmed++;
      else if (type === 'guardrail.redacted') counters.guardrail_events++;
    }

    recent.push(event);
    if (recent.length > bufferSize) recent.shift();

    for (const fn of subscribers) {
      try { fn(event); } catch { /* one bad subscriber must not break the turn */ }
    }
    return event;
  }

  /** subscribe(fn, tenantId?) — omit tenantId for the firehose. */
  function subscribe(fn, tenantId) {
    const wrapped = tenantId
      ? (ev) => { if (ev.tenant_id === tenantId) fn(ev); }
      : fn;
    subscribers.add(wrapped);
    return () => subscribers.delete(wrapped);
  }

  /** snapshot(tenantId?) — omit for global counters + full buffer. */
  function snapshot(tenantId) {
    if (!tenantId) {
      return { counters: { ...globalCounters }, recent: [...recent] };
    }
    return {
      counters: { ...(countersByTenant.get(tenantId) || emptyCounters()) },
      recent: recent.filter((e) => e.tenant_id === tenantId),
    };
  }

  return { emit, subscribe, snapshot };
}

module.exports = { createEventBus, phoneTail };
