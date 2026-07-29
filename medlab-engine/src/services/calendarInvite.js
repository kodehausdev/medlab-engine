// .ics calendar invites for confirmed appointments. Texted as a link
// (routes/calendar.js serves the file) rather than an MMS attachment —
// works over plain SMS with no media-hosting Twilio quirks, and every
// phone's default browser/calendar app already knows how to open a .ics URL.
//
// The link carries a signed token instead of relying on auth, since it goes
// out over SMS/WhatsApp to an unauthenticated patient: a guessed sequential
// booking id alone must not be able to pull another patient's name/test/time.

const crypto = require('crypto');
const config = require('../config');
const { catalogFor } = require('./tools/handlers');
const { DEFAULT_TEST_CATALOG } = require('./tools/schemas');

const DEFAULT_DURATION_MIN = 30;

function signToken(tenantId, appointmentId) {
  return crypto
    .createHmac('sha256', config.calendarTokenSecret)
    .update(`${tenantId}:${appointmentId}`)
    .digest('hex')
    .slice(0, 32);
}

function verifyToken(tenantId, appointmentId, token) {
  const expected = signToken(tenantId, appointmentId);
  const a = Buffer.from(String(token || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Public link a patient can tap to add the appointment to their calendar. */
function buildIcsUrl(tenant, appointment) {
  const token = signToken(tenant.id, appointment.id);
  return `${config.publicBaseUrl}/calendar/${appointment.id}.ics?tenant=${encodeURIComponent(tenant.id)}&t=${token}`;
}

function durationFor(tenant, testType) {
  const catalog = catalogFor(tenant) || DEFAULT_TEST_CATALOG;
  const hit = catalog.find(t => t.name === testType);
  return hit?.duration_min || DEFAULT_DURATION_MIN;
}

function foldLine(line) {
  // RFC 5545 line folding: continuation lines start with a space, 75 octets max.
  if (line.length <= 75) return line;
  const parts = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = ' ' + rest.slice(75);
  }
  parts.push(rest);
  return parts.join('\r\n');
}

function icsEscape(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function toIcsUtc(date) {
  return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

/**
 * buildIcsContent({ tenant, appointment })
 * appointment: { id, patient_name, test_type, date, time_slot } — the same
 * whitelisted shape appointments are stored as (see hipaa.sanitizeAppointment).
 * Uses tenant.timezone to resolve the local date/time_slot to a real instant.
 */
function buildIcsContent({ tenant, appointment }) {
  const durationMin = durationFor(tenant, appointment.test_type);
  const start = zonedTimeToUtc(appointment.date, appointment.time_slot, tenant.timezone);
  const end = new Date(start.getTime() + durationMin * 60000);
  const uid = `booking-${appointment.id}@${tenant.id}.ekaabo`;
  const summary = icsEscape(`${appointment.test_type} — ${tenant.labName}`);
  const description = icsEscape(
    `Lab appointment for ${appointment.patient_name} at ${tenant.labName}. ` +
    `Reply to this number if you need to reschedule.`
  );

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ekaabo//Kesa Appointment//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${icsEscape(tenant.labName)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

/**
 * Resolves a tenant-local 'YYYY-MM-DD' + 'HH:MM' to the correct UTC instant
 * for an IANA zone, via the standard offset-by-round-trip trick: format the
 * naive-UTC guess in the target zone, diff against the same instant
 * formatted in UTC, and shift by that difference. Good to whole-minute
 * precision, which is all a 30-minute-slot scheduler needs.
 */
function zonedTimeToUtc(dateStr, timeStr, timeZone) {
  const naiveUtc = new Date(`${dateStr}T${timeStr}:00Z`);
  const asZoned = new Date(naiveUtc.toLocaleString('en-US', { timeZone }));
  const asUtc = new Date(naiveUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  const offsetMs = asUtc.getTime() - asZoned.getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

module.exports = { buildIcsContent, buildIcsUrl, signToken, verifyToken, zonedTimeToUtc };
