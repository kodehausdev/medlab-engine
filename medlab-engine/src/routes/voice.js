// Voice channel — production path: Twilio <Gather input="speech"> turn loop.
//   POST /webhook/voice           → greeting + first Gather
//   POST /webhook/voice/turn      → SpeechResult → instant filler + Redirect
//   POST /webhook/voice/turn/process → engine → Say + Gather (or Hangup)
// Split into two legs because Twilio can't play anything while a webhook is
// still computing — the filler leg answers instantly so the caller isn't
// sitting in dead silence during the Gemini/tool-call round trip.
// The streaming Gemini Live path is separate (see services/geminiLive.js)
// and is enabled per-tenant by pointing the Twilio number at /webhook/voice/stream.

const express = require('express');
const { gatherTwiml, sayHangupTwiml, streamTwiml, fillerRedirectTwiml } = require('../services/twilio');
const { safeLog } = require('../compliance/hipaa');
const { containsEmergency } = require('../compliance/emergency');
const config = require('../config');

function createVoiceRouter({ engine }) {
  const router = express.Router();
  const turnUrl = `${config.publicBaseUrl}/webhook/voice/turn`;
  const processUrl = `${config.publicBaseUrl}/webhook/voice/turn/process`;

  async function runTurn(req, res, speech) {
    const from = req.body?.From || 'unknown';
    const to = req.body?.To;

    try {
      const { reply, bookedNow, emergency, session, tenant } =
        await engine.processTurn({ channel: 'voice', from, to, text: speech });

      // Emergency gate fired: deliver the scripted 911 redirect and release
      // the line immediately — no further Gather loop.
      if (emergency) {
        engine.endSession('voice', from, tenant);
        return res.type('text/xml').send(sayHangupTwiml(reply));
      }

      // After a confirmed booking, deliver the confirmation and end the call
      // on the model's closing turn rather than looping forever.
      if (bookedNow || (session.completed && /goodbye|bye|that's all|no thanks/i.test(speech))) {
        if (session.completed && !bookedNow) {
          engine.endSession('voice', from, tenant);
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
  }

  router.post('/webhook/voice', async (req, res) => {
    // The called number identifies the lab (multi-tenant routing).
    const tenant = await engine.resolveTenant(req.body?.To);
    // Proactive AI disclosure in the greeting (CA B.O.T. law / Utah AI
    // Policy Act posture): the caller hears they've reached an AI before
    // any data is collected.
    const greeting =
      `Thanks for calling ${tenant.labName}. This is Kesa, ` +
      `an automated A I assistant, and I can book lab appointments — ` +
      `what test do you need, and when?`;
    res.type('text/xml').send(gatherTwiml(greeting, turnUrl));
  });

  router.post('/webhook/voice/turn', (req, res) => {
    const speech = (req.body?.SpeechResult || '').trim();

    if (!speech) {
      return res.type('text/xml').send(
        gatherTwiml('Sorry, I did not catch that. Could you repeat it?', turnUrl)
      );
    }

    // Emergency detection is a cheap synchronous regex check with no model
    // call involved — run it inline and skip the filler so the 911
    // redirect is never delayed by a "one moment" phrase first.
    if (containsEmergency(speech)) {
      return runTurn(req, res, speech);
    }

    // Every other turn needs at least one Gemini call (sometimes a second
    // one plus a tool call/DB round trip). Twilio can't play anything while
    // that's in flight, so respond instantly with a short filler + redirect
    // instead of leaving the caller in dead silence for however long it
    // takes. Twilio re-sends From/To automatically when it follows the
    // redirect.
    res.type('text/xml').send(
      fillerRedirectTwiml(`${processUrl}?speech=${encodeURIComponent(speech)}`)
    );
  });

  router.post('/webhook/voice/turn/process', (req, res) => {
    const speech = (req.query?.speech || '').toString().trim();
    return runTurn(req, res, speech);
  });

  // Beta: route a call into the Gemini Live bidirectional audio bridge.
  router.post('/webhook/voice/stream', (req, res) => {
    const wsUrl = config.publicBaseUrl.replace(/^http/, 'ws') + '/voice/stream';
    res.type('text/xml').send(streamTwiml(wsUrl));
  });

  return router;
}

module.exports = { createVoiceRouter };
