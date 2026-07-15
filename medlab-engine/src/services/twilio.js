// Twilio transport: outbound WhatsApp sends (ported from TCD's
// whatsapp-twilio.js) and TwiML builders for the voice turn loop.

const axios = require('axios');
const config = require('../config');
const { safeLog } = require('../compliance/hipaa');

const MAX_429_RETRIES = 2;
// Twilio's documented WhatsApp Sandbox floor: 1 message per 3 seconds.
// Used only when Twilio doesn't send a Retry-After header on a 429.
const SANDBOX_MIN_INTERVAL_MS = 3000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs one Twilio message with bounded 429 retry. Twilio's Retry-After
 * header (seconds) drives the backoff when present; otherwise falls back to
 * the sandbox's documented 3s floor. Always logs the concrete wait time on
 * both retry and final failure — a bare "429" with no duration is useless
 * for figuring out when to try again.
 */
async function postTwilioMessage(label, to, payload) {
  const { accountSid, authToken } = config.twilio;
  for (let attempt = 0; attempt <= MAX_429_RETRIES; attempt++) {
    try {
      await axios.post(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
        new URLSearchParams(payload).toString(),
        {
          auth: { username: accountSid, password: authToken },
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        }
      );
      safeLog(`📤 [Twilio→${label}] sent to ${to}`);
      return true;
    } catch (e) {
      const status = e.response?.status;
      const retryAfterHeader = e.response?.headers?.['retry-after'];
      const detail = e.response?.data?.message || e.message;

      if (status === 429 && attempt < MAX_429_RETRIES) {
        const waitMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : SANDBOX_MIN_INTERVAL_MS;
        safeLog(
          `⏳ Twilio ${label} send rate-limited (429) — retrying in ${(waitMs / 1000).toFixed(1)}s ` +
          `[attempt ${attempt + 1}/${MAX_429_RETRIES}]`
        );
        await sleep(waitMs);
        continue;
      }

      const waitHint =
        status === 429
          ? retryAfterHeader
            ? ` (Twilio says retry after ${retryAfterHeader}s)`
            : ' (no Retry-After given — Sandbox caps at 1 msg/3s; account-level throughput limits may also apply)'
          : '';
      safeLog(`❌ Twilio ${label} send failed: ${status || ''} ${detail}${waitHint}`);
      return false;
    }
  }
  return false;
}

async function sendWhatsApp(to, body) {
  const { whatsappNumber } = config.twilio;
  const toFormatted = to.startsWith('whatsapp:') ? to : `whatsapp:${to}`;
  await postTwilioMessage('WA', to, { From: whatsappNumber, To: toFormatted, Body: body });
}

/**
 * Outbound SMS. `from` is the tenant number the inbound text arrived on —
 * replies always come from the number the patient texted. Falls back to
 * TWILIO_SMS_NUMBER for sends outside a webhook context.
 */
async function sendSms(to, body, from) {
  const { smsNumber } = config.twilio;
  const fromNumber = from || smsNumber;
  if (!fromNumber) {
    safeLog('❌ Twilio SMS send skipped: no From number (set TWILIO_SMS_NUMBER)');
    return;
  }
  await postTwilioMessage('SMS', to, { From: fromNumber, To: to, Body: body });
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
