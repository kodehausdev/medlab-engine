// Voice channel — production path: Twilio <Gather input="speech"> turn loop.
//   POST /webhook/voice        → greeting + first Gather
//   POST /webhook/voice/turn   → SpeechResult → engine → Say + Gather (or Hangup)
// The streaming Gemini Live path is separate (see services/geminiLive.js)
// and is enabled per-tenant by pointing the Twilio number at /webhook/voice/stream.

const express = require('express');
const { gatherTwiml, sayHangupTwiml, streamTwiml } = require('../services/twilio');
const { safeLog } = require('../compliance/hipaa');
const config = require('../config');

function createVoiceRouter({ engine }) {
  const router = express.Router();
  const turnUrl = `${config.publicBaseUrl}/webhook/voice/turn`;

  router.post('/webhook/voice', (req, res) => {
    const greeting =
      `Thanks for calling ${engine.tenant.labName}. ` +
      `I can book lab appointments — what test do you need, and when?`;
    res.type('text/xml').send(gatherTwiml(greeting, turnUrl));
  });

  router.post('/webhook/voice/turn', async (req, res) => {
    const from = req.body?.From || 'unknown';
    const speech = (req.body?.SpeechResult || '').trim();

    if (!speech) {
      return res.type('text/xml').send(
        gatherTwiml('Sorry, I did not catch that. Could you repeat it?', turnUrl)
      );
    }

    try {
      const { reply, bookedNow, session } =
        await engine.processTurn({ channel: 'voice', from, text: speech });

      // After a confirmed booking, deliver the confirmation and end the call
      // on the model's closing turn rather than looping forever.
      if (bookedNow || (session.completed && /goodbye|bye|that's all|no thanks/i.test(speech))) {
        if (session.completed && !bookedNow) {
          engine.endSession('voice', from);
          return res.type('text/xml').send(sayHangupTwiml(reply));
        }
      }

      res.type('text/xml').send(gatherTwiml(reply, turnUrl));
    } catch (err) {
      safeLog(`❌ Voice turn failed: ${err.message}`);
      res.type('text/xml').send(
        sayHangupTwiml('Sorry, we are having technical trouble. Please call back shortly.')
      );
    }
  });

  // Beta: route a call into the Gemini Live bidirectional audio bridge.
  router.post('/webhook/voice/stream', (req, res) => {
    const wsUrl = config.publicBaseUrl.replace(/^http/, 'ws') + '/voice/stream';
    res.type('text/xml').send(streamTwiml(wsUrl));
  });

  return router;
}

module.exports = { createVoiceRouter };
