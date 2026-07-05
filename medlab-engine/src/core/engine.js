// Channel-agnostic conversation core. This is the descendant of TCD's
// handleMessage(): both the WhatsApp webhook and the voice turn loop feed
// into processTurn(), which owns sessions, the Gemini engine, and tools.

const { createSessionStore } = require('../services/session');
const { createGeminiEngine } = require('../services/gemini');
const { createToolHandlers } = require('../services/tools/handlers');
const { createEventBus } = require('../services/events');
const { createStore } = require('../db/client');
const { safeLog } = require('../compliance/hipaa');
const config = require('../config');

/**
 * createEngine(overrides) — every dependency is injectable for tests:
 *   { store, tenant, generateFn, now, events }
 */
function createEngine(overrides = {}) {
  const tenant = overrides.tenant || config.tenant;
  const store = overrides.store || createStore();
  const events = overrides.events || createEventBus({ tenant });
  const sessions = createSessionStore();
  const toolExecutor = createToolHandlers({ store, tenant, events });
  const gemini = createGeminiEngine({
    tenant,
    toolExecutor,
    generateFn: overrides.generateFn,
  });

  // Every dashboard event is also persisted as a durable audit row
  // (PHI-minimized at the source — see services/events.js). Fire-and-forget:
  // an audit-write failure must never break a caller's turn.
  events.subscribe((ev) => {
    store
      .insertAuditEvent({
        tenant_id: ev.tenant_id,
        event_id: ev.id,
        type: ev.type,
        channel: ev.channel,
        phone_tail: ev.phone_tail,
        data: ev.data,
        created_at: ev.ts,
      })
      .catch((err) => safeLog(`⚠️ audit persist failed: ${err.message}`));
  });

  // Periodic PHI sweep of idle in-memory sessions.
  const sweeper = setInterval(() => sessions.sweep(), 60 * 1000);
  if (sweeper.unref) sweeper.unref();

  /**
   * processTurn({ channel, from, text }) → { reply, bookedNow, session }
   *   channel: 'whatsapp' | 'voice'
   *   from: caller identifier (phone). Passed to tools as callerPhone so
   *         the model can book against caller ID without dictation.
   */
  async function processTurn({ channel, from, text }) {
    const session = sessions.get(channel, from);
    safeLog(`📩 [${channel}] turn from ${from}`);

    const ctx = {
      channel,
      callerPhone: from.replace(/^whatsapp:/, ''),
      now: overrides.now,
    };

    // First turn of a fresh session = a new answered call/conversation.
    if (session.history.length === 0) {
      events.emit('call.answered', { channel, phone: ctx.callerPhone });
    }

    const { reply, bookedNow } = await gemini.runTurn(session, text, ctx);
    if (bookedNow) session.completed = true;

    return { reply, bookedNow, session };
  }

  function endSession(channel, from) {
    sessions.end(channel, from);
  }

  return { processTurn, endSession, store, tenant, toolExecutor, events, _sessions: sessions };
}

module.exports = { createEngine };
