// End-to-end mock orchestration suite. Runs fully offline:
//  - Gemini is a scripted mock injected via generateFn
//  - the datastore is the in-memory store
//  - HTTP goes through a real Express server on an ephemeral port
//
// Primary scenario (per spec): inbound call/text —
//   "Hi, I need to get a lipid panel done this Thursday morning around 10 AM.
//    My name is Alex."
// Reference "today" is Sat 2026-07-04, so "this Thursday" = 2026-07-09.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../src/index');
const { createEngine } = require('../src/core/engine');
const { createMemoryStore } = require('../src/db/client');
const { createToolHandlers } = require('../src/services/tools/handlers');
const { sanitizeAppointment, guardToolArgs, ComplianceError } =
  require('../src/compliance/hipaa');
const { redactText, containsHealthHistory } = require('../src/compliance/redact');
const { createSessionStore, compressHistory } = require('../src/services/session');
const { muLawEncodeSample, muLawDecodeSample } = require('../src/services/geminiLive');
const { TOOL_ARG_WHITELIST } = require('../src/services/tools/schemas');

const TENANT = {
  id: 'test-lab',
  labName: 'BrightPath Diagnostics',
  timezone: 'America/New_York',
  openHour: 8,
  closeHour: 17,
  slotCapacity: 2,
};
const NOW = new Date('2026-07-04T12:00:00Z'); // Saturday
const THURSDAY = '2026-07-09';
const CALLER = '+15551234567';
const ALEX_UTTERANCE =
  'Hi, I need to get a lipid panel done this Thursday morning around 10 AM. My name is Alex.';

/**
 * Scripted Gemini mock: pops one canned step per generate() call.
 * Steps: { functionCalls: [...] } or { text: '...' }.
 */
function scriptedModel(steps) {
  const queue = [...steps];
  const seen = []; // contents snapshots, for prompt assertions
  const fn = async (contents, systemInstruction) => {
    seen.push({ contents: JSON.parse(JSON.stringify(contents)), systemInstruction });
    const step = queue.shift();
    if (!step) return { text: 'Anything else I can help with?', functionCalls: [] };
    return { text: step.text || '', functionCalls: step.functionCalls || [] };
  };
  fn.seen = seen;
  return fn;
}

function alexBookingScript() {
  return scriptedModel([
    {
      functionCalls: [
        { name: 'check_availability', args: { date: THURSDAY, time_slot: '10:00' } },
      ],
    },
    {
      functionCalls: [
        {
          name: 'book_appointment',
          args: {
            patient_name: 'Alex',
            phone_number: CALLER,
            test_type: 'Lipid Panel',
            date: THURSDAY,
            time_slot: '10:00',
          },
        },
      ],
    },
    {
      text: `You're all set, Alex — Lipid Panel on Thursday July 9th at 10 AM at BrightPath Diagnostics. Anything else?`,
    },
  ]);
}

// ── HTTP harness ──────────────────────────────────────────────
function startServer(appBundle) {
  return new Promise((resolve) => {
    const server = appBundle.app.listen(0, () => {
      resolve({ server, port: server.address().port });
    });
  });
}

async function postForm(port, path, fields) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: res.status, body: await res.text() };
}

function waitFor(predicate, timeoutMs = 3000, intervalMs = 20) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const tick = () => {
      if (predicate()) return resolve();
      if (Date.now() - t0 > timeoutMs) return reject(new Error('waitFor timeout'));
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// ══════════════════════════════════════════════════════════════
// 1. VOICE E2E — webhook → Gather loop → Gemini → book_appointment → TwiML
// ══════════════════════════════════════════════════════════════
test('voice: full booking flow returns confirmation TwiML and persists a clean record', async () => {
  const store = createMemoryStore();
  const generateFn = alexBookingScript();
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);

  try {
    // Call connects → greeting TwiML with a speech Gather
    const greet = await postForm(port, '/webhook/voice', { From: CALLER, CallSid: 'CA1' });
    assert.equal(greet.status, 200);
    assert.match(greet.body, /<Gather input="speech"/);
    assert.match(greet.body, /BrightPath Diagnostics/);

    // Caller speaks the scenario utterance
    const turn = await postForm(port, '/webhook/voice/turn', {
      From: CALLER,
      CallSid: 'CA1',
      SpeechResult: ALEX_UTTERANCE,
    });
    assert.equal(turn.status, 200);

    // Confirmation is spoken back and the line stays open for follow-ups
    assert.match(turn.body, /<Say[^>]*>You&apos;re all set, Alex/);
    assert.match(turn.body, /Lipid Panel on Thursday July 9th at 10 AM/);
    assert.match(turn.body, /<Gather/);

    // The mock model was actually prompted with the caller's words
    assert.ok(
      generateFn.seen[0].contents.some(c =>
        c.parts?.some(p => p.text === ALEX_UTTERANCE)),
      'Gemini prompt must contain the raw utterance turn'
    );
    // System prompt carries the resolved reference date
    assert.match(generateFn.seen[0].systemInstruction, /2026-07-04/);

    // Exactly one appointment, whitelisted fields only, correct values
    assert.equal(store.appointments.length, 1);
    const appt = store.appointments[0];
    assert.equal(appt.patient_name, 'Alex');
    assert.equal(appt.phone_number, CALLER);
    assert.equal(appt.test_type, 'Lipid Panel');
    assert.equal(appt.date, THURSDAY);
    assert.equal(appt.time_slot, '10:00');
    assert.equal(appt.channel, 'voice');
    assert.equal(appt.status, 'confirmed');
    assert.equal(appt.tenant_id, 'test-lab');
  } finally {
    server.close();
  }
});

// ══════════════════════════════════════════════════════════════
// 2. WHATSAPP E2E — webhook → batcher → Gemini → booking → outbound reply
// ══════════════════════════════════════════════════════════════
test('whatsapp: inbound text is batched, booked, and confirmed via outbound send', async () => {
  const store = createMemoryStore();
  const generateFn = alexBookingScript();
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const sent = [];
  const bundle = createApp({
    engine,
    sendWhatsApp: async (to, body) => sent.push({ to, body }),
    batchWindowMs: 10,
  });
  const { server, port } = await startServer(bundle);

  try {
    const waFrom = `whatsapp:${CALLER}`;
    const res = await postForm(port, '/webhook/whatsapp', {
      From: waFrom,
      Body: ALEX_UTTERANCE,
      MessageSid: 'SM_test_1',
    });
    assert.equal(res.status, 200); // ack precedes processing

    await waitFor(() => sent.length >= 1);

    assert.equal(sent[0].to, waFrom);
    assert.match(sent[0].body, /You're all set, Alex/);
    assert.match(sent[0].body, /Lipid Panel/);

    const appt = store.appointments[0];
    assert.equal(store.appointments.length, 1);
    assert.equal(appt.channel, 'whatsapp');
    assert.equal(appt.phone_number, CALLER); // whatsapp: prefix stripped

    // Duplicate MessageSid must be ignored (Twilio retry semantics)
    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, Body: ALEX_UTTERANCE, MessageSid: 'SM_test_1',
    });
    await new Promise(r => setTimeout(r, 60));
    assert.equal(store.appointments.length, 1, 'dedupe must block replayed webhook');
  } finally {
    server.close();
  }
});

// ══════════════════════════════════════════════════════════════
// 3. HIPAA GUARDRAILS
// ══════════════════════════════════════════════════════════════
test('hipaa: non-whitelisted tool args are stripped before execution', () => {
  const { clean, stripped } = guardToolArgs(
    'book_appointment',
    {
      patient_name: 'Alex',
      phone_number: CALLER,
      test_type: 'Lipid Panel',
      date: THURSDAY,
      time_slot: '10:00',
      medical_history: 'type 2, on metformin', // hallucinated field
      insurance_id: 'ABC123456',
    },
    TOOL_ARG_WHITELIST.book_appointment
  );
  assert.deepEqual(stripped.sort(), ['insurance_id', 'medical_history']);
  assert.equal(clean.medical_history, undefined);
  assert.equal(clean.patient_name, 'Alex');
});

test('hipaa: health-history content inside a whitelisted field is a hard rejection', () => {
  assert.throws(
    () => guardToolArgs(
      'book_appointment',
      { patient_name: 'Alex, diabetic patient' },
      TOOL_ARG_WHITELIST.book_appointment
    ),
    ComplianceError
  );
});

test('hipaa: engine refuses to store a booking carrying diagnosis text, stores nothing', async () => {
  const store = createMemoryStore();
  const generateFn = scriptedModel([
    {
      functionCalls: [{
        name: 'book_appointment',
        args: {
          patient_name: 'Alex — my doctor said I have high cholesterol',
          phone_number: CALLER,
          test_type: 'Lipid Panel',
          date: THURSDAY,
          time_slot: '10:00',
        },
      }],
    },
    { text: "You don't need to share any medical details with me — could I have just your name?" },
  ]);
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });

  const { reply, bookedNow } = await engine.processTurn({
    channel: 'voice', from: CALLER, text: 'booking attempt with PHI',
  });

  assert.equal(bookedNow, false);
  assert.equal(store.appointments.length, 0, 'no record may be written');
  assert.match(reply, /medical details/i);
});

test('hipaa: sanitizeAppointment whitelists fields and rejects PHI in values', () => {
  const { record, dropped } = sanitizeAppointment({
    tenant_id: 't', patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'voice', status: 'confirmed', created_at: 'x',
    diagnosis: 'should never persist', raw_transcript: 'should never persist',
  });
  assert.deepEqual(dropped.sort(), ['diagnosis', 'raw_transcript']);
  assert.equal(Object.keys(record).length, 9);

  assert.throws(
    () => sanitizeAppointment({ patient_name: 'Alex, pregnant' }),
    ComplianceError
  );
});

test('hipaa: log redaction masks SSN, DOB, insurance IDs and phone tails', () => {
  const dirty =
    'Alex 555-12-3456, DOB: 01/02/1980, member id: XZ99887766, call +1 555 123 4567';
  const clean = redactText(dirty);
  assert.doesNotMatch(clean, /555-12-3456/);
  assert.doesNotMatch(clean, /01\/02\/1980/);
  assert.doesNotMatch(clean, /XZ99887766/);
  assert.match(clean, /\[PHONE-\*\*\*\*4567\]/);
  assert.equal(containsHealthHistory('I am on metformin for my diabetes'), 'diabet');
  assert.equal(containsHealthHistory('book me a blood draw at ten'), null);
});

// ══════════════════════════════════════════════════════════════
// 4. TOOL HANDLERS — availability, catalog, capacity
// ══════════════════════════════════════════════════════════════
test('tools: list_available_tests returns the catalog', async () => {
  const exec = createToolHandlers({ store: createMemoryStore(), tenant: TENANT });
  const out = await exec.execute('list_available_tests', {}, {});
  const names = out.tests.map(t => t.name);
  assert.ok(names.includes('Blood Draw'));
  assert.ok(names.includes('Lipid Panel'));
  assert.ok(names.includes('PCR Scan'));
});

test('tools: capacity enforcement — a full slot rejects further bookings', async () => {
  const store = createMemoryStore();
  const exec = createToolHandlers({ store, tenant: TENANT });
  const base = {
    phone_number: CALLER, test_type: 'Blood Draw', date: THURSDAY, time_slot: '09:00',
  };

  const a = await exec.execute('book_appointment', { ...base, patient_name: 'P One' }, {});
  const b = await exec.execute('book_appointment', { ...base, patient_name: 'P Two' }, {});
  assert.equal(a.confirmed, true);
  assert.equal(b.confirmed, true);

  const avail = await exec.execute('check_availability', { date: THURSDAY, time_slot: '09:00' }, {});
  assert.equal(avail.requested_slot_available, false);

  const c = await exec.execute('book_appointment', { ...base, patient_name: 'P Three' }, {});
  assert.equal(c.confirmed, undefined);
  assert.match(c.error, /full/);
  assert.equal(store.appointments.length, 2);
});

test('tools: fuzzy test-type matching and validation errors', async () => {
  const exec = createToolHandlers({ store: createMemoryStore(), tenant: TENANT });

  const ok = await exec.execute('book_appointment', {
    patient_name: 'Alex', phone_number: CALLER,
    test_type: 'lipid', date: THURSDAY, time_slot: '10:30',
  }, {});
  assert.equal(ok.test_type, 'Lipid Panel');

  const badDate = await exec.execute('check_availability', { date: 'Thursday' }, {});
  assert.match(badDate.error, /YYYY-MM-DD/);

  const badTest = await exec.execute('book_appointment', {
    patient_name: 'Alex', phone_number: CALLER,
    test_type: 'MRI', date: THURSDAY, time_slot: '10:00',
  }, {});
  assert.match(badTest.error, /Unknown test/);
});

// ══════════════════════════════════════════════════════════════
// 5. SESSION — context compression carries facts, drops transcript
// ══════════════════════════════════════════════════════════════
test('session: history past the cap compresses into a facts summary', () => {
  const sessions = createSessionStore();
  const s = sessions.get('voice', CALLER);
  s.facts = { patient_name: 'Alex', test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00' };

  for (let i = 0; i < 20; i++) {
    s.history.push({ role: i % 2 ? 'model' : 'user', parts: [{ text: `turn ${i}` }] });
  }
  compressHistory(s);

  assert.equal(s.history.length, 9); // 1 summary + 8 recent
  const summary = s.history[0].parts[0].text;
  assert.match(summary, /patient name: Alex/);
  assert.match(summary, /slot: 10:00/);
  assert.doesNotMatch(summary, /turn 0/, 'raw early transcript must not survive compression');
});

test('session: TTL sweep evicts idle sessions (PHI leaves RAM)', () => {
  const sessions = createSessionStore({ ttlMs: 1 });
  sessions.get('voice', CALLER).history.push({ role: 'user', parts: [{ text: 'x' }] });
  const t0 = Date.now();
  while (Date.now() - t0 < 5) { /* let TTL lapse */ }
  sessions.sweep();
  assert.equal(sessions._sessions.size, 0);
});

// ══════════════════════════════════════════════════════════════
// 6. DASHBOARD FEED — SSE stream + state snapshot
// ══════════════════════════════════════════════════════════════
async function readSseUntil(reader, predicate, timeoutMs = 3000) {
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer
      .split('\n\n')
      .flatMap(block => block.split('\n'))
      .filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6)));
    const hit = events.find(predicate);
    if (hit) return { hit, events };
  }
  throw new Error('SSE event not received before timeout');
}

test('dashboard: booking flow streams call.answered + booking.confirmed over SSE', async () => {
  const store = createMemoryStore();
  const generateFn = alexBookingScript();
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);
  const controller = new AbortController();

  try {
    const sse = await fetch(`http://127.0.0.1:${port}/api/dashboard/events`, {
      signal: controller.signal,
    });
    assert.match(sse.headers.get('content-type'), /^text\/event-stream/);
    const reader = sse.body.getReader();

    await postForm(port, '/webhook/voice/turn', {
      From: CALLER, CallSid: 'CA_sse', SpeechResult: ALEX_UTTERANCE,
    });

    const { hit, events } = await readSseUntil(reader, e => e.type === 'booking.confirmed');
    assert.ok(events.some(e => e.type === 'call.answered'), 'call.answered must precede booking');
    assert.equal(hit.tenant_id, 'test-lab');
    assert.equal(hit.channel, 'voice');
    assert.equal(hit.phone_tail, '4567'); // last 4 only — full number never leaves
    assert.equal(hit.data.patient_name, 'Alex');
    assert.equal(hit.data.test_type, 'Lipid Panel');
    assert.equal(hit.data.date, THURSDAY);
    assert.equal(hit.data.time_slot, '10:00');
    assert.doesNotMatch(JSON.stringify(hit), /\+15551234567/, 'raw phone must not appear');

    const state = await (await fetch(`http://127.0.0.1:${port}/api/dashboard/state`)).json();
    assert.equal(state.tenant.lab_name, 'BrightPath Diagnostics');
    assert.equal(state.counters.calls_answered, 1);
    assert.equal(state.counters.bookings_confirmed, 1);
    assert.ok(state.recent.some(e => e.type === 'booking.confirmed'));
  } finally {
    controller.abort();
    server.close();
  }
});

test('dashboard: ComplianceError emits a PHI-free guardrail.redacted event', async () => {
  const store = createMemoryStore();
  const generateFn = scriptedModel([
    {
      functionCalls: [{
        name: 'book_appointment',
        args: {
          patient_name: 'Alex — my doctor said I have high cholesterol',
          phone_number: CALLER,
          test_type: 'Lipid Panel',
          date: THURSDAY,
          time_slot: '10:00',
        },
      }],
    },
    { text: "You don't need to share any medical details with me — just your name, please." },
  ]);
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });

  const received = [];
  engine.events.subscribe(e => received.push(e));

  await engine.processTurn({ channel: 'voice', from: CALLER, text: 'booking attempt with PHI' });

  const guardrail = received.find(e => e.type === 'guardrail.redacted');
  assert.ok(guardrail, 'guardrail.redacted must be emitted');
  assert.equal(guardrail.data.tool, 'book_appointment');
  assert.equal(guardrail.data.status, 'guardrail_redacted');
  assert.equal(guardrail.phone_tail, '4567');

  // The event itself must not leak what the caller said or which term matched.
  const wire = JSON.stringify(guardrail).toLowerCase();
  assert.doesNotMatch(wire, /cholesterol|doctor said|diagnos/);
  assert.equal(store.appointments.length, 0);
  assert.equal(engine.events.snapshot().counters.guardrail_events, 1);
});

test('dashboard: every event is persisted as a durable audit row', async () => {
  const store = createMemoryStore();
  const engine = createEngine({ store, tenant: TENANT, generateFn: alexBookingScript(), now: NOW });

  await engine.processTurn({ channel: 'whatsapp', from: `whatsapp:${CALLER}`, text: ALEX_UTTERANCE });
  await new Promise(r => setImmediate(r)); // let fire-and-forget writes settle

  assert.equal(store.auditEvents.length, 2);
  const [answered, booked] = store.auditEvents;
  assert.equal(answered.type, 'call.answered');
  assert.equal(booked.type, 'booking.confirmed');
  assert.equal(booked.tenant_id, 'test-lab');
  assert.equal(booked.channel, 'whatsapp');
  assert.equal(booked.phone_tail, '4567');
  assert.equal(booked.data.patient_name, 'Alex');
  assert.equal(booked.event_id, booked.event_id.match(/^evt-\d+$/)?.[0]);
  // Raw phone number must not appear anywhere in the durable row.
  assert.doesNotMatch(JSON.stringify(store.auditEvents), /\+15551234567/);
});

// ══════════════════════════════════════════════════════════════
// 7. AUDIO CODEC — μ-law round trip sanity for the Live bridge
// ══════════════════════════════════════════════════════════════
test('codec: mu-law encode/decode round trip stays within tolerance', () => {
  for (const s of [0, 500, -500, 8000, -8000, 30000, -30000]) {
    const rt = muLawDecodeSample(muLawEncodeSample(s));
    const tolerance = Math.max(64, Math.abs(s) * 0.06); // logarithmic quantization
    assert.ok(Math.abs(rt - s) <= tolerance, `sample ${s} → ${rt} exceeds tolerance`);
  }
});
