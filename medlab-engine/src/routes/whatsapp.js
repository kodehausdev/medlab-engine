// WhatsApp text channel. Direct port of TCD's /webhook/twilio pattern:
// ack immediately, dedupe on MessageSid, batch rapid messages per sender —
// but with a short window (4s) tuned for conversation, not bulk paste.

const express = require('express');
const { safeLog } = require('../compliance/hipaa');

const BATCH_WINDOW_MS = 4000;
const DEDUPE_MAX = 1000;

function createWhatsAppRouter({ engine, sendWhatsApp, batchWindowMs = BATCH_WINDOW_MS }) {
  const router = express.Router();
  const processed = new Set();
  const messageQueue = {};

  async function handleTurn(from, to, text) {
    try {
      const { reply } = await engine.processTurn({ channel: 'whatsapp', from, to, text });
      await sendWhatsApp(from, reply);
    } catch (err) {
      safeLog(`❌ WhatsApp turn failed: ${err.message}`);
      await sendWhatsApp(
        from,
        'Sorry — something went wrong on our side. Please send that again in a moment.'
      );
    }
  }

  router.post('/webhook/whatsapp', (req, res) => {
    res.sendStatus(200); // ack before processing, Twilio retries otherwise

    const from = req.body?.From;
    const to = req.body?.To; // WA sender the message arrived on → tenant
    const text = req.body?.Body?.trim();
    if (!from || !text) return;

    const msgSid = req.body?.MessageSid || `${from}:${Date.now()}`;
    if (processed.has(msgSid)) return;
    processed.add(msgSid);
    if (processed.size > DEDUPE_MAX) processed.clear();

    safeLog(`📩 [WA] inbound from ${from}`);

    // Batch rapid consecutive messages (people text in fragments) into one
    // turn — keyed per (tenant number, sender) so labs never share a batch.
    const qk = `${to || 'default'}|${from}`;
    if (!messageQueue[qk]) messageQueue[qk] = { texts: [], timer: null };
    messageQueue[qk].texts.push(text);
    if (messageQueue[qk].timer) clearTimeout(messageQueue[qk].timer);
    messageQueue[qk].timer = setTimeout(() => {
      const batch = messageQueue[qk].texts.join('\n');
      delete messageQueue[qk];
      handleTurn(from, to, batch);
    }, batchWindowMs);
  });

  return router;
}

module.exports = { createWhatsAppRouter, BATCH_WINDOW_MS };
