// Twilio transport: outbound WhatsApp sends (ported from TCD's
// whatsapp-twilio.js) and TwiML builders for the voice turn loop.

const axios = require('axios');
const config = require('../config');
const { safeLog } = require('../compliance/hipaa');

async function sendWhatsApp(to, body) {
  const { accountSid, authToken, whatsappNumber } = config.twilio;
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  try {
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({ From: whatsappNumber, To: toFormatted, Body: body }).toString(),
      {
        auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    safeLog(`📤 [Twilio→WA] sent to ${to}`);
  } catch (e) {
    safeLog(`❌ Twilio WA send failed: ${e.response?.status || ''} ${e.message}`);
  }
}

/**
 * Outbound SMS. `from` is the tenant number the inbound text arrived on —
 * replies always come from the number the patient texted. Falls back to
 * TWILIO_SMS_NUMBER for sends outside a webhook context.
 */
async function sendSms(to, body, from) {
  const { accountSid, authToken, smsNumber } = config.twilio;
  const fromNumber = from || smsNumber;
  if (!fromNumber) {
    safeLog('❌ Twilio SMS send skipped: no From number (set TWILIO_SMS_NUMBER)');
    return;
  }
  try {
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      new URLSearchParams({ From: fromNumber, To: to, Body: body }).toString(),
      {
        auth: { username: accountSid, password: authToken },
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }
    );
    safeLog(`📤 [Twilio→SMS] sent to ${to}`);
  } catch (e) {
    safeLog(`❌ Twilio SMS send failed: ${e.response?.status || ''} ${e.message}`);
  }
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * TwiML: speak `text`, then listen for the caller's next utterance and POST
 * the SpeechResult to `actionUrl`.
 */
function gatherTwiml(text, actionUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${escapeXml(actionUrl)}" method="POST" speechTimeout="auto" language="en-US">
    <Say voice="Google.en-US-Neural2-C">${escapeXml(text)}</Say>
  </Gather>
  <Say voice="Google.en-US-Neural2-C">I didn't hear anything. Goodbye.</Say>
  <Hangup/>
</Response>`;
}

/** TwiML: speak a final message and hang up. */
function sayHangupTwiml(text) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Google.en-US-Neural2-C">${escapeXml(text)}</Say>
  <Hangup/>
</Response>`;
}

/** TwiML: bridge the call into the Gemini Live media-stream endpoint (beta). */
function streamTwiml(wsUrl) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(wsUrl)}"/>
  </Connect>
</Response>`;
}

module.exports = { sendWhatsApp, sendSms, gatherTwiml, sayHangupTwiml, streamTwiml };
