// WhatsApp text channel — thin wrapper over the shared text-channel webhook
// (see textChannel.js for dedupe, TCPA opt-out gate, and batching).
// Outbound replies go through sendWhatsApp, sent from the tenant WhatsApp
// number the inbound message arrived on — same per-tenant-sender pattern as
// sms.js, so multi-tenant labs each reply from their own WhatsApp number
// instead of all sharing the single TWILIO_WHATSAPP_NUMBER fallback.

const { createTextChannelRouter, BATCH_WINDOW_MS, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS } =
  require('./textChannel');

function createWhatsAppRouter({ engine, sendWhatsApp, batchWindowMs }) {
  return createTextChannelRouter({
    engine,
    channel: 'whatsapp',
    webhookPath: '/webhook/whatsapp',
    send: (recipient, body, viaNumber) => sendWhatsApp(recipient, body, viaNumber),
    batchWindowMs,
  });
}

module.exports = { createWhatsAppRouter, BATCH_WINDOW_MS, OPT_OUT_KEYWORDS, OPT_IN_KEYWORDS };
