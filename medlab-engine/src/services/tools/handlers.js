// Backend execution functions for Gemini tool calls.
// Every call passes through hipaa.guardToolArgs first; book_appointment
// additionally passes through hipaa.sanitizeAppointment before the store.

const {
  guardToolArgs, sanitizeAppointment, ComplianceError, safeLog,
} = require('../../compliance/hipaa');
const { TOOL_ARG_WHITELIST, TEST_CATALOG } = require('./schemas');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLOT_RE = /^([01]\d|2[0-3]):(00|30)$/;

function normalizeTestType(input) {
  if (!input) return null;
  const q = input.trim().toLowerCase();
  const hit = TEST_CATALOG.find(
    t => t.name.toLowerCase() === q ||
         t.code.toLowerCase() === q ||
         t.name.toLowerCase().includes(q) ||
         q.includes(t.name.toLowerCase())
  );
  return hit ? hit.name : null;
}

function buildDaySlots(tenant) {
  const slots = [];
  for (let h = tenant.openHour; h < tenant.closeHour; h++) {
    slots.push(`${String(h).padStart(2, '0')}:00`);
    slots.push(`${String(h).padStart(2, '0')}:30`);
  }
  return slots;
}

/**
 * createToolHandlers({ store, tenant, events }) → { execute(name, args, ctx) }
 * ctx carries per-conversation facts the model shouldn't have to restate,
 * e.g. the caller's phone number from Twilio caller ID.
 * events (optional) is the dashboard bus from services/events.
 */
function createToolHandlers({ store, tenant, events }) {
  const bus = events || { emit: () => {} };
  const handlers = {
    async list_available_tests() {
      return {
        tests: TEST_CATALOG.map(t => ({ name: t.name, duration_minutes: t.duration_min })),
      };
    },

    async check_availability(args) {
      const { date, time_slot } = args;
      if (!DATE_RE.test(date || '')) {
        return { error: 'Invalid date. Expected YYYY-MM-DD.' };
      }
      const allSlots = buildDaySlots(tenant);
      const wanted = time_slot ? [time_slot] : allSlots;
      if (time_slot && !SLOT_RE.test(time_slot)) {
        return { error: 'Invalid time_slot. Expected HH:MM on a 30-minute boundary.' };
      }

      const taken = await store.bookingsOn(tenant.id, date);
      const countBySlot = {};
      for (const b of taken) {
        countBySlot[b.time_slot] = (countBySlot[b.time_slot] || 0) + 1;
      }

      const open = wanted.filter(
        s => allSlots.includes(s) && (countBySlot[s] || 0) < tenant.slotCapacity
      );

      return {
        date,
        open_slots: open,
        requested_slot_available: time_slot ? open.includes(time_slot) : undefined,
      };
    },

    async book_appointment(args, ctx = {}) {
      const { patient_name, phone_number, test_type, date, time_slot } = args;

      if (!DATE_RE.test(date || '')) return { error: 'Invalid date. Expected YYYY-MM-DD.' };
      if (!SLOT_RE.test(time_slot || '')) {
        return { error: 'Invalid time_slot. Expected HH:MM on a 30-minute boundary.' };
      }
      if (!patient_name?.trim()) return { error: 'patient_name is required.' };

      const canonicalTest = normalizeTestType(test_type);
      if (!canonicalTest) {
        return {
          error: `Unknown test "${test_type}". Offer the caller one of: ${TEST_CATALOG.map(t => t.name).join(', ')}.`,
        };
      }

      const phone = (phone_number || ctx.callerPhone || '').replace(/^whatsapp:/, '').trim();
      if (!phone) return { error: 'phone_number is required.' };

      const booked = await store.countBookings(tenant.id, date, time_slot);
      if (booked >= tenant.slotCapacity) {
        return { error: `The ${time_slot} slot on ${date} is full. Offer a nearby open slot.` };
      }

      // Minimum-necessary gate: whitelist-only write.
      const { record, dropped } = sanitizeAppointment({
        tenant_id: tenant.id,
        patient_name: patient_name.trim(),
        phone_number: phone,
        test_type: canonicalTest,
        date,
        time_slot,
        channel: ctx.channel || 'unknown',
        status: 'confirmed',
        created_at: new Date().toISOString(),
      });
      if (dropped.length) safeLog('⚠️ sanitizeAppointment dropped fields:', dropped.join(','));

      const saved = await store.insertAppointment(record);
      safeLog(`✅ Booking #${saved.id} — ${canonicalTest} ${date} ${time_slot} [${tenant.id}]`);

      bus.emit('booking.confirmed', { channel: ctx.channel, phone }, {
        booking_id: saved.id,
        patient_name: record.patient_name,
        test_type: canonicalTest,
        date,
        time_slot,
        status: 'confirmed',
        summary: `${canonicalTest} booked for ${date} at ${time_slot}; confirmed over ${ctx.channel || 'phone'}.`,
      });

      return {
        confirmed: true,
        booking_id: saved.id,
        patient_name: record.patient_name,
        test_type: canonicalTest,
        date,
        time_slot,
        lab_name: tenant.labName,
      };
    },
  };

  return {
    /**
     * Guarded dispatch: strips non-whitelisted args, rejects health-history
     * content, executes, and always returns a JSON-serializable result the
     * model can consume as a functionResponse.
     */
    async execute(name, rawArgs, ctx) {
      const handler = handlers[name];
      if (!handler) return { error: `Unknown tool: ${name}` };

      try {
        const { clean, stripped } = guardToolArgs(name, rawArgs, TOOL_ARG_WHITELIST[name] || []);
        if (stripped.length) {
          safeLog(`🛡️ [${name}] stripped non-whitelisted args:`, stripped.join(','));
        }
        return await handler(clean, ctx);
      } catch (err) {
        if (err instanceof ComplianceError) {
          safeLog(`🛡️ ComplianceError in ${name}: ${err.message}`);
          // Dashboard event carries only the fact of interception — no caller
          // content, no matched term (see services/events.js).
          bus.emit('guardrail.redacted', { channel: ctx?.channel, phone: ctx?.callerPhone }, {
            tool: name,
            code: err.code,
            status: 'guardrail_redacted',
            summary:
              'Caller volunteered restricted health information mid-call. ' +
              'Intercepted by the compliance layer — nothing was stored or executed.',
          });
          return {
            error:
              'Rejected: this system only collects name, phone number, test type and appointment time. ' +
              'Do not collect or restate medical history. Tell the caller their health details are not needed for booking.',
          };
        }
        safeLog(`❌ Tool ${name} failed: ${err.message}`);
        return { error: 'Internal error executing that action. Apologize and offer to try again.' };
      }
    },
  };
}

module.exports = { createToolHandlers, normalizeTestType, buildDaySlots };
