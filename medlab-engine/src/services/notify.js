// Emergency paging: best-effort, PHI-free alerts to whoever the tenant
// configured in Settings (tenants.notify_email / notify_sms_number — see
// db/client.js's mapTenantRow) when the emergency gate fires. Fire-and-forget
// from core/engine.js's processTurn — a paging failure must never affect the
// caller's own experience, since the scripted 911/ER redirect has already
// been decided and delivered by the time this runs. Both sends already
// swallow their own errors (just a safeLog), so callers never need to catch.

const axios = require('axios');
const config = require('../config');
const { safeLog } = require('../compliance/hipaa');
const { sendSms } = require('./twilio');
const { phoneTail } = require('./events');

async function sendAlertEmail(to, subject, text) {
  const { apiKey, from } = config.resend;
  if (!apiKey || !from) {
    safeLog('❌ Emergency email page skipped: RESEND_API_KEY/EMERGENCY_ALERT_FROM_EMAIL not configured');
    return;
  }
  try {
    await axios.post(
      'https://api.resend.com/emails',
      { from, to, subject, text },
      { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' } }
    );
    safeLog(`📧 Emergency page emailed to ${to}`);
  } catch (e) {
    safeLog(`❌ Emergency email page failed: ${e.response?.data?.message || e.message}`);
  }
}

/**
 * pageEmergency(tenant, { channel, phone })
 * No-op if the tenant hasn't configured a notify_email / notify_sms_number.
 * The message deliberately carries no caller content — same posture as the
 * emergency.detected dashboard event it mirrors: only the fact that the
 * scripted redirect fired, a channel, and a 4-digit phone tail.
 */
async function pageEmergency(tenant, { channel, phone } = {}) {
  if (!tenant?.notifyEmail && !tenant?.notifySmsNumber) return;

  const labName = tenant.labName || 'Your lab';
  const tail = phoneTail(phone) || '????';
  const kind = channel === 'voice' ? 'call' : 'text message';
  const message =
    `${labName}: a possible medical emergency was reported on a ${kind} ` +
    `(caller ending ${tail}). The AI receptionist gave the scripted 911/ER redirect ` +
    `and took no booking action. No further details are collected — see the ` +
    `Compliance page's Emergency Redirects log in the console.`;

  const jobs = [];
  if (tenant.notifyEmail) {
    jobs.push(sendAlertEmail(tenant.notifyEmail, `⚠ Possible emergency — ${labName}`, message));
  }
  if (tenant.notifySmsNumber) {
    jobs.push(sendSms(tenant.notifySmsNumber, message, tenant.twilioNumber));
  }
  await Promise.allSettled(jobs);
}

module.exports = { pageEmergency };
