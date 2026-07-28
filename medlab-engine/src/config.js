require('dotenv').config();

const config = {
  port: Number(process.env.PORT || 3000),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || '',

  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    liveModel: process.env.GEMINI_LIVE_MODEL || 'gemini-2.0-flash-live-001',
    // Vertex AI path (production / BAA route). Auth is Application Default
    // Credentials — `gcloud auth application-default login` locally, or an
    // attached service account when deployed. No API key, no key file.
    useVertex: process.env.GEMINI_USE_VERTEX === 'true',
    project: process.env.GOOGLE_CLOUD_PROJECT || '',
    location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    key: process.env.SUPABASE_KEY || '',
  },

  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || '',
    authToken: process.env.TWILIO_AUTH_TOKEN || '',
    whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || '',
    // Outbound SMS fallback From. Usually unneeded: replies go out from the
    // tenant number the inbound text arrived on.
    smsNumber: process.env.TWILIO_SMS_NUMBER || '',
    // Enable on deployed engines (needs the exact public URL to verify).
    validateWebhooks: process.env.TWILIO_VALIDATE_WEBHOOKS === 'true',
  },

  // Emergency-page email (services/notify.js). SMS paging reuses the Twilio
  // config above — no separate credential needed for that half.
  resend: {
    apiKey: process.env.RESEND_API_KEY || '',
    from: process.env.EMERGENCY_ALERT_FROM_EMAIL || '',
  },

  // Signs the .ics calendar-invite links texted to patients (services/
  // calendarInvite.js) so a guessed booking id alone can't pull another
  // patient's name/test/time. Falls back to the Twilio auth token (already
  // a private secret every deployed instance has) rather than forcing a new
  // required env var; the hardcoded fallback only matters for local dev with
  // neither set.
  calendarTokenSecret:
    process.env.CALENDAR_TOKEN_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dev-insecure-calendar-secret-change-me',

  // How long before an appointment the reminder text goes out, and how often
  // the poller checks for appointments that just entered that window.
  reminderLeadHours: Number(process.env.REMINDER_LEAD_HOURS || 24),
  reminderPollMinutes: Number(process.env.REMINDER_POLL_MINUTES || 15),

  tenant: {
    id: process.env.TENANT_ID || 'default',
    labName: process.env.LAB_NAME || 'MedLab',
    timezone: process.env.LAB_TIMEZONE || 'America/New_York',
    openHour: Number(process.env.LAB_OPEN_HOUR || 8),
    closeHour: Number(process.env.LAB_CLOSE_HOUR || 17),
    slotCapacity: Number(process.env.SLOT_CAPACITY || 2),
  },
};

module.exports = config;
