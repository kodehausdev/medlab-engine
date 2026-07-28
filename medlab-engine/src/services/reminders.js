// Appointment reminder texts — two touches per booking, the pattern the
// patient-scheduling incumbents (Solutionreach, Weave) converged on:
//   1. day-before (REMINDER_LEAD_HOURS, default 24h): full details + the
//      calendar link — enough notice to reschedule and backfill the slot.
//   2. same-day  (REMINDER_SAMEDAY_LEAD_HOURS, default 2h): a short nudge —
//      catches plain forgetfulness, which the day-before touch doesn't.
// A booking made inside the same-day window gets ONE text stamped as both
// touches — never two reminders minutes apart.
//
// No new job-runner infra: medlab-engine is already a long-running process
// (Railway), so this is a poll interval wired up in core/engine.js the same
// way the session sweeper is. Each touch is tracked in its own column
// (reminder_sent_at / reminder_sameday_sent_at) so a restart or a slow poll
// tick can never double-send.

const config = require('../config');
const { safeLog } = require('../compliance/hipaa');
const { buildIcsUrl, zonedTimeToUtc } = require('./calendarInvite');
const { sendSms: realSendSms, sendWhatsApp: realSendWhatsApp } = require('./twilio');

function buildReminderMessage(tenant, appointment) {
  const icsUrl = buildIcsUrl(tenant, appointment);
  return (
    `Reminder: you have a ${appointment.test_type} appointment at ${tenant.labName} ` +
    `on ${appointment.date} at ${appointment.time_slot}. Add to calendar: ${icsUrl} ` +
    `Reply if you need to reschedule.`
  );
}

// Same-day nudge: short, no link — the day-before text already carried it.
function buildSamedayMessage(tenant, appointment) {
  return (
    `Reminder: your ${appointment.test_type} appointment at ${tenant.labName} ` +
    `is today at ${appointment.time_slot}. Reply if you can't make it.`
  );
}

/**
 * runReminderSweep({ store, getTenant, send, now })
 *   store     — db/client.js store (appointmentsPendingReminder, markReminderSent)
 *   getTenant — tenantId => tenant | null (core/engine.js's getTenantById,
 *               which already handles the memory-store single-tenant fallback)
 *   send      — { sendSms, sendWhatsApp } overrides, for tests
 *   now       — inject a fixed Date for deterministic tests
 */
async function runReminderSweep({ store, getTenant, send, now = new Date() } = {}) {
  const sendSms = send?.sendSms || realSendSms;
  const sendWhatsApp = send?.sendWhatsApp || realSendWhatsApp;
  const leadMs = config.reminderLeadHours * 60 * 60 * 1000;
  const samedayLeadMs = config.reminderSamedayLeadHours * 60 * 60 * 1000;

  // Broad date window (today through +2 days) comfortably covers any
  // timezone's actual lead-time instant for a lead setting up to 48h; the
  // real due-or-not decision happens below, in the tenant's own timezone.
  const dateFrom = now.toISOString().split('T')[0];
  const dateTo = new Date(now.getTime() + 2 * 86400000).toISOString().split('T')[0];

  let candidates = [];
  try {
    candidates = await store.appointmentsPendingReminder(dateFrom, dateTo);
  } catch (err) {
    safeLog(`⚠️ reminder sweep: fetch failed: ${err.message}`);
    return { sent: 0, checked: 0 };
  }

  let sent = 0;
  for (const appt of candidates) {
    let tenant = null;
    try {
      tenant = await getTenant(appt.tenant_id);
    } catch {
      continue;
    }
    if (!tenant) continue;

    // TCPA: the STOP gate suppresses conversational replies, but reminders
    // are system-initiated sends — they must honor the opt-out registry too.
    try {
      if (await store.isOptedOut(appt.tenant_id, appt.phone_number)) continue;
    } catch {
      continue; // can't verify opt-out state — don't send
    }

    const apptUtc = zonedTimeToUtc(appt.date, appt.time_slot, tenant.timezone);
    const msUntil = apptUtc.getTime() - now.getTime();
    // Skip appointments already past (a slow restart shouldn't text someone
    // about a slot that already happened).
    if (msUntil <= 0) continue;

    // Which touch is due right now? Same-day wins when both are pending
    // (a booking made <samedayLead ahead) — one message, stamped as both.
    let message, kind;
    if (!appt.reminder_sameday_sent_at && msUntil <= samedayLeadMs) {
      message = buildSamedayMessage(tenant, appt);
      kind = appt.reminder_sent_at ? 'same_day' : 'both';
    } else if (!appt.reminder_sent_at && msUntil <= leadMs) {
      message = buildReminderMessage(tenant, appt);
      kind = 'day_before';
    } else {
      continue; // neither window entered yet
    }

    try {
      if (appt.channel === 'whatsapp') {
        await sendWhatsApp(appt.phone_number, message, tenant.whatsappNumber);
      } else {
        await sendSms(appt.phone_number, message, tenant.twilioNumber);
      }
      await store.markReminderSent(appt.tenant_id, appt.id, kind);
      sent++;
    } catch (err) {
      safeLog(`⚠️ reminder send failed for booking #${appt.id}: ${err.message}`);
    }
  }

  return { sent, checked: candidates.length };
}

module.exports = { runReminderSweep, buildReminderMessage, buildSamedayMessage };
