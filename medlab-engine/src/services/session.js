// Per-caller conversation state. Held IN MEMORY ONLY with a TTL — this is a
// deliberate HIPAA design decision: raw transcripts are never persisted.
// The only durable artifacts of a conversation are whitelisted appointment
// rows (db) and redacted audit lines.

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes of inactivity
const MAX_HISTORY_TURNS = 12;          // context-compression threshold

function createSessionStore({ ttlMs = SESSION_TTL_MS } = {}) {
  const sessions = new Map();

  function key(channel, from) {
    return `${channel}:${from}`;
  }

  function get(channel, from, tenantId) {
    const k = key(channel, from);
    const existing = sessions.get(k);
    if (existing && Date.now() - existing.touchedAt < ttlMs) {
      existing.touchedAt = Date.now();
      return existing;
    }
    const fresh = {
      key: k,
      channel,
      from,
      tenantId,            // set once, at creation — used by demo-lead capture
      history: [],        // Gemini `contents` format: { role, parts }
      facts: {},          // structured slots: patient_name, test_type, date, time_slot
      completed: false,   // set true once a booking is confirmed
      touchedAt: Date.now(),
    };
    sessions.set(k, fresh);
    return fresh;
  }

  // Returns the removed session (or undefined if none) so a caller can react
  // to how a conversation ended — see core/engine.js's demo-lead capture.
  function end(channel, from) {
    const k = key(channel, from);
    const session = sessions.get(k);
    sessions.delete(k);
    return session;
  }

  // Opportunistic sweep so long-running processes don't accumulate PHI in RAM.
  // onEvict(session), if given, fires for each session right before it's
  // dropped — the only way to observe a conversation that just went idle
  // (a caller hanging up without saying goodbye never calls end()).
  function sweep(onEvict) {
    const now = Date.now();
    for (const [k, s] of sessions) {
      if (now - s.touchedAt >= ttlMs) {
        sessions.delete(k);
        if (onEvict) onEvict(s);
      }
    }
  }

  return { get, end, sweep, _sessions: sessions };
}

/**
 * Context compression. When history exceeds MAX_HISTORY_TURNS, collapse
 * everything but the most recent turns into a single deterministic
 * "known facts" line built from the structured slots — never from raw
 * transcript text. Costs zero extra model calls and carries zero
 * unstructured PHI forward.
 */
function compressHistory(session) {
  if (session.history.length <= MAX_HISTORY_TURNS) return session.history;

  const recent = session.history.slice(-8);
  const f = session.facts;
  const factBits = [
    f.patient_name && `patient name: ${f.patient_name}`,
    f.test_type && `test: ${f.test_type}`,
    f.date && `date: ${f.date}`,
    f.time_slot && `slot: ${f.time_slot}`,
  ].filter(Boolean);

  const summaryTurn = {
    role: 'user',
    parts: [{
      text:
        `[Conversation summary — earlier turns compressed] ` +
        (factBits.length ? `Confirmed so far: ${factBits.join('; ')}.` : 'No details confirmed yet.'),
    }],
  };

  session.history = [summaryTurn, ...recent];
  return session.history;
}

module.exports = { createSessionStore, compressHistory, MAX_HISTORY_TURNS };
