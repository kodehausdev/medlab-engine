// Appointment reminder texts. No new job-runner infra: medlab-engine is
// already a long-running process (Railway), so this is a poll interval
// wired up in core/engine.js the same way the session sweeper is — not a
// cron job or queue. Fires once per booking, config.reminderLeadHours before
// the slot, tracked via appointments.reminder_sent_at so a restart or a
// slow poll tick can never double-send.

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

    const apptUtc = zonedTimeToUtc(appt.date, appt.time_slot, tenant.timezone);
    const msUntil = apptUtc.getTime() - now.getTime();
    // Due once inside the lead window; skip appointments already past (a
    // slow restart shouldn't text someone about a slot that already happened).
    if (msUntil <= 0 || msUntil > leadMs) continue;

    const message = buildReminderMessage(tenant, appt);
    try {
      if (appt.channel === 'whatsapp') {
        await sendWhatsApp(appt.phone_number, message, tenant.whatsappNumber);
      } else {
        await sendSms(appt.phone_number, message, tenant.twilioNumber);
      }
      await store.markReminderSent(appt.tenant_id, appt.id);
      sent++;
    } catch (err) {
      safeLog(`⚠️ reminder send failed for booking #${appt.id}: ${err.message}`);
    }
  }

  return { sent, checked: candidates.length };
}

module.exports = { runReminderSweep, buildReminderMessage };
