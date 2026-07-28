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

async function getPath(port, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`);
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
test('whatsapp: inbound text is batched, booked, and confirmed via outbound send from the tenant\'s own WA number', async () => {
  const store = createMemoryStore();
  const generateFn = alexBookingScript();
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const sent = [];
  const bundle = createApp({
    engine,
    sendWhatsApp: async (to, body, from) => sent.push({ to, body, from }),
    batchWindowMs: 10,
  });
  const { server, port } = await startServer(bundle);

  try {
    const waFrom = `whatsapp:${CALLER}`;
    const waTo = 'whatsapp:+15005550006'; // the tenant's own registered WA number
    const res = await postForm(port, '/webhook/whatsapp', {
      From: waFrom,
      To: waTo,
      Body: ALEX_UTTERANCE,
      MessageSid: 'SM_test_1',
    });
    assert.equal(res.status, 200); // ack precedes processing
    // The ack body must be empty TwiML — Twilio renders a plain-text body
    // (like sendStatus's "OK") as a visible reply bubble.
    assert.match(res.body, /<Response><\/Response>/);
    assert.doesNotMatch(res.body, /OK/);

    await waitFor(() => sent.length >= 1);

    assert.equal(sent[0].to, waFrom);
    // Replies must go out from the number the patient actually messaged, not
    // a single shared TWILIO_WHATSAPP_NUMBER — otherwise every tenant's
    // WhatsApp replies collide on one sender.
    assert.equal(sent[0].from, waTo);
    assert.match(sent[0].body, /You're all set, Alex/);
    assert.match(sent[0].body, /Lipid Panel/);

    const appt = store.appointments[0];
    assert.equal(store.appointments.length, 1);
    assert.equal(appt.channel, 'whatsapp');
    assert.equal(appt.phone_number, CALLER); // whatsapp: prefix stripped

    // Duplicate MessageSid must be ignored (Twilio retry semantics)
    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, To: waTo, Body: ALEX_UTTERANCE, MessageSid: 'SM_test_1',
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

test('tools: blocked windows stop the AI from offering or booking a slot, without touching existing bookings in it', async () => {
  const store = createMemoryStore();
  const exec = createToolHandlers({ store, tenant: TENANT });

  // Existing confirmed booking in the slot, made before it was blocked.
  const pre = await exec.execute('book_appointment', {
    patient_name: 'Early Bird', phone_number: CALLER,
    test_type: 'Blood Draw', date: THURSDAY, time_slot: '11:00',
  }, {});
  assert.equal(pre.confirmed, true);

  store.blocks.push({ tenant_id: TENANT.id, date: THURSDAY, time_slot: '11:00', reason: 'Staff meeting' });

  const avail = await exec.execute('check_availability', { date: THURSDAY, time_slot: '11:00' }, {});
  assert.equal(avail.requested_slot_available, false);

  const allDay = await exec.execute('check_availability', { date: THURSDAY }, {});
  assert.ok(!allDay.open_slots.includes('11:00'));

  const blocked = await exec.execute('book_appointment', {
    patient_name: 'Late Comer', phone_number: CALLER,
    test_type: 'Blood Draw', date: THURSDAY, time_slot: '11:00',
  }, {});
  assert.equal(blocked.confirmed, undefined);
  assert.match(blocked.error, /not available/);

  // The pre-existing booking is untouched — a block holds new capacity, it
  // doesn't cancel what's already there.
  assert.equal(store.appointments.length, 1);
  assert.equal(store.appointments[0].id, pre.booking_id);
});

test('tools: a per-tenant test catalog overrides the default six tests', async () => {
  const customTenant = {
    ...TENANT,
    testCatalog: [{ code: 'X_RAY', name: 'Chest X-Ray', duration_min: 20 }],
  };
  const exec = createToolHandlers({ store: createMemoryStore(), tenant: customTenant });

  const list = await exec.execute('list_available_tests', {}, {});
  assert.deepEqual(list.tests, [{ name: 'Chest X-Ray', duration_minutes: 20 }]);

  // A test that only exists in the DEFAULT catalog is unknown to this tenant.
  const rejected = await exec.execute('book_appointment', {
    patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '09:00',
  }, {});
  assert.match(rejected.error, /Unknown test/);
  assert.match(rejected.error, /Chest X-Ray/);

  const ok = await exec.execute('book_appointment', {
    patient_name: 'Alex', phone_number: CALLER,
    test_type: 'x-ray', date: THURSDAY, time_slot: '09:00',
  }, {});
  assert.equal(ok.test_type, 'Chest X-Ray');
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
// 7. MULTI-TENANT ROUTING — inbound To number → tenant
// ══════════════════════════════════════════════════════════════
const LAB2 = {
  id: 'lab2',
  labName: 'Lakeside Labs',
  timezone: 'America/Chicago',
  openHour: 9,
  closeHour: 18,
  slotCapacity: 1,
  whatsappNumber: '+15550002222',
};

function twoTenantStore() {
  const store = createMemoryStore();
  store.getTenantByNumber = async (number) =>
    number === LAB2.whatsappNumber ? LAB2 : null;
  store.getTenantById = async (id) => (id === LAB2.id ? LAB2 : null);
  return store;
}

test('routing: the To number selects the tenant; unmatched falls back to default', async () => {
  const store = twoTenantStore();
  // Two independent booking conversations, one scripted model per tenant.
  const s1 = alexBookingScript();
  const s2 = alexBookingScript();
  let active = s1;
  const gen = async (contents, sys) => active(contents, sys);

  const engine = createEngine({ store, tenant: TENANT, generateFn: gen, now: NOW });

  // Caller texts LAB2's WhatsApp sender.
  const r1 = await engine.processTurn({
    channel: 'whatsapp',
    from: `whatsapp:${CALLER}`,
    to: `whatsapp:${LAB2.whatsappNumber}`,
    text: ALEX_UTTERANCE,
  });
  assert.equal(r1.tenant.id, 'lab2');
  assert.match(r1.reply, /Lipid Panel/);

  // Same caller texts an unknown number → default tenant.
  active = s2;
  const r2 = await engine.processTurn({
    channel: 'whatsapp',
    from: `whatsapp:${CALLER}`,
    to: 'whatsapp:+19999999999',
    text: ALEX_UTTERANCE,
  });
  assert.equal(r2.tenant.id, 'test-lab');

  // Each booking landed under its own tenant.
  const byTenant = Object.groupBy
    ? Object.groupBy(store.appointments, (a) => a.tenant_id)
    : store.appointments.reduce((m, a) => ((m[a.tenant_id] ||= []).push(a), m), {});
  assert.equal(byTenant.lab2.length, 1);
  assert.equal(byTenant['test-lab'].length, 1);

  // Sessions are isolated per tenant (same caller, two conversations).
  assert.equal(r1.session !== r2.session, true);

  // System prompts carried each lab's own identity.
  assert.match(s1.seen[0].systemInstruction, /Lakeside Labs/);
  assert.match(s2.seen[0].systemInstruction, /BrightPath Diagnostics/);

  // Events are tenant-tagged with scoped counters.
  assert.equal(engine.events.snapshot('lab2').counters.bookings_confirmed, 1);
  assert.equal(engine.events.snapshot('test-lab').counters.bookings_confirmed, 1);
  assert.equal(engine.events.snapshot().counters.bookings_confirmed, 2);
});

test('routing: dashboard state + SSE are tenant-scoped; unknown tenant is 404', async () => {
  const store = twoTenantStore();
  const engine = createEngine({ store, tenant: TENANT, generateFn: alexBookingScript(), now: NOW });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);

  try {
    await engine.processTurn({
      channel: 'whatsapp',
      from: `whatsapp:${CALLER}`,
      to: `whatsapp:${LAB2.whatsappNumber}`,
      text: ALEX_UTTERANCE,
    });

    const scoped = await (await fetch(`http://127.0.0.1:${port}/api/dashboard/state?tenant=lab2`)).json();
    assert.equal(scoped.tenant.lab_name, 'Lakeside Labs');
    assert.equal(scoped.counters.bookings_confirmed, 1);
    assert.ok(scoped.recent.every(e => e.tenant_id === 'lab2'));

    const missing = await fetch(`http://127.0.0.1:${port}/api/dashboard/state?tenant=nope`);
    assert.equal(missing.status, 404);

    // Scoped SSE replays only lab2 events.
    const controller = new AbortController();
    const sse = await fetch(`http://127.0.0.1:${port}/api/dashboard/events?tenant=lab2`, {
      signal: controller.signal,
    });
    const { hit, events } = await readSseUntil(
      sse.body.getReader(),
      e => e.type === 'booking.confirmed'
    );
    assert.ok(events.every(e => e.tenant_id === 'lab2'));
    assert.equal(hit.data.patient_name, 'Alex');
    controller.abort();
  } finally {
    server.close();
  }
});

// ══════════════════════════════════════════════════════════════
// 8. DASHBOARD AUTH + TWILIO SIGNATURE
// ══════════════════════════════════════════════════════════════
test('dashboard auth: 401 without token, 403 for foreign tenant, scoped 200 with token', async () => {
  const engine = createEngine({
    store: createMemoryStore(), tenant: TENANT,
    generateFn: alexBookingScript(), now: NOW,
  });
  // Stubbed verifier: token "good" belongs to test-lab.
  const dashboardAuth = {
    open: false,
    resolve: async (req) => {
      const token = req.query.token ||
        (req.headers.authorization || '').replace(/^Bearer /, '');
      return token === 'good'
        ? { ok: true, tenantId: 'test-lab' }
        : { ok: false, status: 401, error: 'Invalid token.' };
    },
  };
  const bundle = createApp({ engine, dashboardAuth });
  const { server, port } = await startServer(bundle);
  const base = `http://127.0.0.1:${port}/api/dashboard`;

  try {
    assert.equal((await fetch(`${base}/state`)).status, 401);
    assert.equal((await fetch(`${base}/events`)).status, 401);
    assert.equal((await fetch(`${base}/state?token=bad`)).status, 401);
    assert.equal(
      (await fetch(`${base}/state?token=good&tenant=someone-else`)).status,
      403,
      'a valid token must not read another tenant'
    );

    const ok = await fetch(`${base}/state?token=good`);
    assert.equal(ok.status, 200);
    const state = await ok.json();
    assert.equal(state.tenant.id, 'test-lab', 'token pins the tenant scope');

    const viaHeader = await fetch(`${base}/state`, {
      headers: { Authorization: 'Bearer good' },
    });
    assert.equal(viaHeader.status, 200);
  } finally {
    server.close();
  }
});

test('twilio signature guard: valid HMAC passes, tampered payload rejected', () => {
  const { twilioSignatureGuard, expectedSignature } = require('../src/services/twilioSig');
  const guard = twilioSignatureGuard({
    authToken: 'tok_secret', publicBaseUrl: 'https://engine.example', enabled: true,
  });
  const resStub = () => {
    const r = { code: null, status(c) { r.code = c; return r; }, send() { return r; } };
    return r;
  };
  const params = { From: '+15551234567', Body: 'hello', MessageSid: 'SM1' };
  const sig = expectedSignature('tok_secret', 'https://engine.example/webhook/whatsapp', params);

  let passed = false;
  guard(
    { headers: { 'x-twilio-signature': sig }, originalUrl: '/webhook/whatsapp', body: params },
    resStub(), () => { passed = true; }
  );
  assert.equal(passed, true);

  const res = resStub();
  guard(
    { headers: { 'x-twilio-signature': sig }, originalUrl: '/webhook/whatsapp',
      body: { ...params, Body: 'tampered' } },
    res, () => assert.fail('tampered body must not pass')
  );
  assert.equal(res.code, 403);

  const res2 = resStub();
  guard(
    { headers: {}, originalUrl: '/webhook/whatsapp', body: params },
    res2, () => assert.fail('missing signature must not pass')
  );
  assert.equal(res2.code, 403);
});

// ══════════════════════════════════════════════════════════════
// 9. AUDIO CODEC — μ-law round trip sanity for the Live bridge
// ══════════════════════════════════════════════════════════════
test('codec: mu-law encode/decode round trip stays within tolerance', () => {
  for (const s of [0, 500, -500, 8000, -8000, 30000, -30000]) {
    const rt = muLawDecodeSample(muLawEncodeSample(s));
    const tolerance = Math.max(64, Math.abs(s) * 0.06); // logarithmic quantization
    assert.ok(Math.abs(rt - s) <= tolerance, `sample ${s} → ${rt} exceeds tolerance`);
  }
});

// ══════════════════════════════════════════════════════════════
// 10. FEED REHYDRATION — restart must not blank the dashboard
// ══════════════════════════════════════════════════════════════
test('dashboard: engine seeds counters + ring buffer from the audit trail at boot', async () => {
  const store = createMemoryStore();
  store.auditSeed = async () => ({
    recent: [
      { id: 7, tenant_id: 'test-lab', event_id: 'evt-7', type: 'call.answered',
        channel: 'whatsapp', phone_tail: '3985', data: {}, created_at: '2026-07-07T11:48:35Z' },
      { id: 8, tenant_id: 'test-lab', event_id: 'evt-8', type: 'booking.confirmed',
        channel: 'whatsapp', phone_tail: '3985',
        data: { patient_name: 'Pete Burg', test_type: 'PCR Scan' },
        created_at: '2026-07-07T11:54:27Z' },
      { id: 3, tenant_id: 'other-lab', event_id: 'evt-3', type: 'call.answered',
        channel: 'voice', phone_tail: '0042', data: {}, created_at: '2026-07-05T14:22:00Z' },
    ],
    // Tallies span MORE history than the buffer — counters must use these.
    tallies: [
      { tenant_id: 'test-lab', type: 'call.answered' },
      { tenant_id: 'test-lab', type: 'call.answered' },
      { tenant_id: 'test-lab', type: 'booking.confirmed' },
      { tenant_id: 'other-lab', type: 'call.answered' },
    ],
  });

  const engine = createEngine({ store, tenant: TENANT, generateFn: scriptedModel([]), now: NOW });
  await engine.ready;

  const scoped = engine.events.snapshot('test-lab');
  assert.equal(scoped.counters.calls_answered, 2, 'counters come from tallies, not the buffer');
  assert.equal(scoped.counters.bookings_confirmed, 1);
  assert.deepEqual(scoped.recent.map(e => e.id), ['evt-7', 'evt-8'], 'chronological, tenant-scoped');
  assert.equal(scoped.recent[1].data.patient_name, 'Pete Burg');
  assert.equal(engine.events.snapshot('other-lab').counters.calls_answered, 1);

  // seq resumes past the highest db id — a live emit must not collide with
  // seeded ids (the console dedupes by id).
  const live = engine.events.emit('call.answered', { tenantId: 'test-lab', channel: 'voice' });
  assert.equal(live.id, 'evt-9');
  assert.equal(engine.events.snapshot('test-lab').counters.calls_answered, 3);
});

// ══════════════════════════════════════════════════════════════
// 11. US-MARKET GUARDRAILS — emergency gate, TCPA opt-out,
//     AI disclosure, cancel/reschedule
// ══════════════════════════════════════════════════════════════
const { containsEmergency } = require('../src/compliance/emergency');

test('emergency: distress language short-circuits BEFORE the model — scripted 911 redirect', async () => {
  const store = createMemoryStore();
  const generateFn = scriptedModel([{ text: 'model must never produce this' }]);
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });

  const { reply, emergency, bookedNow, session } = await engine.processTurn({
    channel: 'voice', from: CALLER, text: 'I am having chest pain right now',
  });

  assert.equal(emergency, true);
  assert.equal(bookedNow, false);
  assert.match(reply, /9 ?1 ?1/);
  assert.equal(generateFn.seen.length, 0, 'the model must not see an emergency turn');
  assert.equal(session.history.length, 0, 'distress text must never enter session history');
  assert.equal(store.appointments.length, 0);

  // PHI-free audit event + counter
  const ev = engine.events.snapshot().recent.find(e => e.type === 'emergency.detected');
  assert.ok(ev, 'emergency.detected must be emitted');
  assert.equal(ev.data.status, 'emergency_redirected');
  assert.doesNotMatch(JSON.stringify(ev), /chest pain/i, 'event must carry no caller content');
  assert.equal(engine.events.snapshot().counters.emergency_events, 1);

  // Word-boundary matching: real terms fire, lookalikes don't
  assert.equal(containsEmergency('my dad is unconscious'), 'unconscious');
  assert.equal(containsEmergency('I want to log my keystrokes'), null);
  assert.equal(containsEmergency('book me a blood draw tomorrow'), null);
});

test('emergency: paging fires to the tenant\'s configured contacts, without delaying the caller\'s redirect', async () => {
  const paged = [];
  const engine = createEngine({
    store: createMemoryStore(),
    tenant: { ...TENANT, notifyEmail: 'frontdesk@brightpath.test', notifySmsNumber: '+15559990000' },
    generateFn: scriptedModel([]),
    now: NOW,
    notify: async (tenant, ctx) => { paged.push({ tenant, ctx }); },
  });

  const { reply, emergency } = await engine.processTurn({
    channel: 'voice', from: CALLER, text: 'she is having a seizure',
  });
  assert.equal(emergency, true);
  assert.match(reply, /9 ?1 ?1/);

  // Fire-and-forget: paging is invoked, but processTurn already returned —
  // give the microtask queue one tick to observe it landed.
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(paged.length, 1);
  assert.equal(paged[0].tenant.notifyEmail, 'frontdesk@brightpath.test');
  assert.equal(paged[0].ctx.channel, 'voice');
  assert.equal(paged[0].ctx.phone, CALLER);
});

test('notify: pageEmergency is a safe no-op for a tenant with no notification contacts configured', async () => {
  const { pageEmergency } = require('../src/services/notify');
  // No notifyEmail/notifySmsNumber on TENANT — must resolve without ever
  // attempting a network call (which would hang/fail in the test sandbox).
  await pageEmergency(TENANT, { channel: 'voice', phone: CALLER });
});

test('emergency: voice route speaks the redirect and hangs up — no Gather loop', async () => {
  const engine = createEngine({
    store: createMemoryStore(), tenant: TENANT,
    generateFn: scriptedModel([]), now: NOW,
  });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);
  try {
    const turn = await postForm(port, '/webhook/voice/turn', {
      From: CALLER, CallSid: 'CA_emerg', SpeechResult: 'I think my husband is having a stroke',
    });
    assert.equal(turn.status, 200);
    assert.match(turn.body, /9 1 1/);
    assert.match(turn.body, /<Hangup\/>/);
    assert.doesNotMatch(turn.body, /<Gather/);
  } finally {
    server.close();
  }
});

test('tcpa: STOP is honored deterministically — suppresses the AI until START restores', async () => {
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
  const waFrom = `whatsapp:${CALLER}`;

  try {
    // STOP → opt-out recorded + single confirmation, model never invoked
    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, Body: 'STOP', MessageSid: 'SM_stop_1',
    });
    await waitFor(() => sent.length >= 1);
    assert.match(sent[0].body, /unsubscribed/i);
    assert.match(sent[0].body, /START/);
    assert.equal(await store.isOptedOut('test-lab', CALLER), true);
    assert.equal(generateFn.seen.length, 0, 'STOP must never reach the model');
    const optEv = engine.events.snapshot().recent.find(e => e.type === 'optout.received');
    assert.ok(optEv, 'optout.received must be emitted');

    // Opted out: a booking attempt is suppressed with a service note only
    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, Body: ALEX_UTTERANCE, MessageSid: 'SM_stop_2',
    });
    await waitFor(() => sent.length >= 2);
    assert.match(sent[1].body, /opted out/i);
    await new Promise(r => setTimeout(r, 40)); // outlast the batch window
    assert.equal(generateFn.seen.length, 0, 'opted-out messages must not reach the model');
    assert.equal(store.appointments.length, 0);

    // START → restored, then booking flows normally again
    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, Body: 'start', MessageSid: 'SM_stop_3',
    });
    await waitFor(() => sent.length >= 3);
    assert.match(sent[2].body, /re-subscribed/i);
    assert.equal(await store.isOptedOut('test-lab', CALLER), false);

    await postForm(port, '/webhook/whatsapp', {
      From: waFrom, Body: ALEX_UTTERANCE, MessageSid: 'SM_stop_4',
    });
    await waitFor(() => store.appointments.length >= 1);
    assert.equal(store.appointments[0].patient_name, 'Alex');
  } finally {
    server.close();
  }
});

test('disclosure: voice greeting and first WhatsApp reply identify the AI', async () => {
  const store = createMemoryStore();
  const engine = createEngine({
    store, tenant: TENANT,
    generateFn: scriptedModel([
      { text: 'Hi! What test would you like to book?' },
      { text: 'Great — what day works for you?' },
    ]),
    now: NOW,
  });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);
  try {
    const greet = await postForm(port, '/webhook/voice', { From: CALLER, CallSid: 'CA_disc' });
    assert.match(greet.body, /A I assistant/, 'voice greeting must disclose the AI');
  } finally {
    server.close();
  }

  // First WA turn gets the deterministic disclosure prefix…
  const first = await engine.processTurn({
    channel: 'whatsapp', from: `whatsapp:${CALLER}`, text: 'hi',
  });
  assert.match(first.reply, /^You're chatting with Kesa, BrightPath Diagnostics's automated AI assistant\./);

  // …and later turns don't repeat it.
  const second = await engine.processTurn({
    channel: 'whatsapp', from: `whatsapp:${CALLER}`, text: 'a blood draw please',
  });
  assert.doesNotMatch(second.reply, /automated AI assistant/);

  // The system prompt carries the never-claim-human rule.
  const { buildSystemPrompt } = require('../src/services/gemini');
  assert.match(buildSystemPrompt(TENANT, '2026-07-04'), /Never claim or imply you are human/);
});

test('demo tenant: systemPromptOverride replaces the default prompt, with the same date placeholders interpolated', () => {
  const { buildSystemPrompt } = require('../src/services/gemini');
  const demoTenant = {
    ...TENANT,
    systemPromptOverride: 'Today is {todayISO}, a {weekday}. Next week: {calendar}. You are Kesa.',
  };
  const prompt = buildSystemPrompt(demoTenant, '2026-07-04');
  assert.equal(prompt, 'Today is 2026-07-04, a Saturday. Next week: Sunday = 2026-07-05, Monday = 2026-07-06, Tuesday = 2026-07-07, Wednesday = 2026-07-08, Thursday = 2026-07-09, Friday = 2026-07-10, Saturday = 2026-07-11. You are Kesa.');
  assert.doesNotMatch(prompt, /AI receptionist for/, 'the default template must not leak through');

  // A tenant with no override still gets the normal prompt.
  assert.match(buildSystemPrompt(TENANT, '2026-07-04'), /You are Kesa, the AI receptionist for/);
});

test('tools: cancel flow — find_my_appointments + cancel_appointment frees the slot', async () => {
  const store = createMemoryStore();
  await store.insertAppointment({
    tenant_id: 'test-lab', patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'voice', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const generateFn = scriptedModel([
    { functionCalls: [{ name: 'find_my_appointments', args: {} }] },
    { functionCalls: [{ name: 'cancel_appointment', args: { booking_id: 1 } }] },
    { text: 'Done — your Lipid Panel on Thursday at 10 AM is cancelled. Anything else?' },
  ]);
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });

  const { reply } = await engine.processTurn({
    channel: 'voice', from: CALLER, text: 'I need to drop my Thursday booking',
  });

  assert.match(reply, /cancelled/i);
  assert.equal(store.appointments[0].status, 'cancelled');
  assert.equal(await store.countBookings('test-lab', THURSDAY, '10:00'), 0, 'slot must be freed');

  const ev = engine.events.snapshot().recent.find(e => e.type === 'booking.cancelled');
  assert.ok(ev, 'booking.cancelled must be emitted');
  assert.equal(ev.data.booking_id, 1);
  assert.equal(ev.data.status, 'cancelled');
});

test('tools: cancel_appointment rejects a booking_id that is not the caller own booking', async () => {
  const store = createMemoryStore();
  await store.insertAppointment({
    tenant_id: 'test-lab', patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'voice', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const toolExecutor = createToolHandlers({ store, tenant: TENANT });
  const result = await toolExecutor.execute(
    'cancel_appointment',
    { booking_id: 1 },
    { tenant: TENANT, callerPhone: '+15550009999', now: NOW } // different caller
  );

  assert.ok(result.error, 'foreign caller must not cancel the booking');
  assert.equal(store.appointments[0].status, 'confirmed', 'record must be untouched');
});

test('pause: tenants.ai_paused stops booking without touching the model, but emergencies still work', async () => {
  const store = createMemoryStore();
  const PAUSED = { ...TENANT, aiPaused: true };
  const generateFn = scriptedModel([{ text: 'model must never be called while paused' }]);
  const engine = createEngine({ store, tenant: PAUSED, generateFn, now: NOW });

  const { reply, bookedNow } = await engine.processTurn({
    channel: 'whatsapp', from: CALLER, text: ALEX_UTTERANCE,
  });

  assert.match(reply, /temporarily unavailable/i);
  assert.equal(bookedNow, false);
  assert.equal(generateFn.seen.length, 0, 'the model must not run while paused');
  assert.equal(store.appointments.length, 0);
  assert.equal(engine.events.snapshot().counters.calls_answered, 1, 'still counts as an answered turn');

  // Emergency gate must win even on a paused tenant — pausing turns off
  // bookings, not the model-independent 911 redirect.
  const emergencyEngine = createEngine({
    store: createMemoryStore(), tenant: PAUSED,
    generateFn: scriptedModel([{ text: 'model must never produce this' }]), now: NOW,
  });
  const emerg = await emergencyEngine.processTurn({
    channel: 'voice', from: CALLER, text: 'I am having chest pain right now',
  });
  assert.equal(emerg.emergency, true);
  assert.match(emerg.reply, /9 ?1 ?1/);
});

// ══════════════════════════════════════════════════════════════
// 12. SMS CHANNEL — US text-to-book over plain Twilio SMS
// ══════════════════════════════════════════════════════════════
test('sms: text-to-book flows end to end — disclosure, tenant-number reply, sms channel row', async () => {
  const store = createMemoryStore();
  const generateFn = alexBookingScript();
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const sent = [];
  const bundle = createApp({
    engine,
    sendSms: async (to, body, via) => sent.push({ to, body, via }),
    batchWindowMs: 10,
  });
  const { server, port } = await startServer(bundle);
  const LAB_NUMBER = '+15550001111';

  try {
    const res = await postForm(port, '/webhook/sms', {
      From: CALLER,
      To: LAB_NUMBER,
      Body: ALEX_UTTERANCE,
      MessageSid: 'SM_sms_1',
    });
    assert.equal(res.status, 200);

    await waitFor(() => sent.length >= 1);

    // Reply goes back to the caller FROM the number they texted
    assert.equal(sent[0].to, CALLER);
    assert.equal(sent[0].via, LAB_NUMBER);
    // First text reply carries the AI disclosure, then the confirmation
    assert.match(sent[0].body, /^You're chatting with Kesa, BrightPath Diagnostics's automated AI assistant\./);
    assert.match(sent[0].body, /You're all set, Alex/);

    // Appointment row is channel-tagged 'sms'
    assert.equal(store.appointments.length, 1);
    assert.equal(store.appointments[0].channel, 'sms');
    assert.equal(store.appointments[0].phone_number, CALLER);
  } finally {
    server.close();
  }
});

test('sms: the TCPA STOP gate covers SMS through the shared text-channel router', async () => {
  const store = createMemoryStore();
  const generateFn = scriptedModel([{ text: 'model must not run' }]);
  const engine = createEngine({ store, tenant: TENANT, generateFn, now: NOW });
  const sent = [];
  const bundle = createApp({
    engine,
    sendSms: async (to, body, via) => sent.push({ to, body, via }),
    batchWindowMs: 10,
  });
  const { server, port } = await startServer(bundle);

  try {
    await postForm(port, '/webhook/sms', {
      From: CALLER, To: '+15550001111', Body: 'STOP', MessageSid: 'SM_sms_stop',
    });
    await waitFor(() => sent.length >= 1);
    assert.match(sent[0].body, /unsubscribed/i);
    assert.equal(await store.isOptedOut('test-lab', CALLER), true);
    assert.equal(generateFn.seen.length, 0, 'STOP must never reach the model');
  } finally {
    server.close();
  }
});

// ══════════════════════════════════════════════════════════════
// 12. SUNRISE-DEMO — public demo tenant, lead capture
// ══════════════════════════════════════════════════════════════
const { classifyDemoOutcome, captureDemoLead, DEMO_TEST_NAME } = require('../src/services/leads');

test('demo lead: classifyDemoOutcome — booked the demo, booked something else, just asked, or nothing worth logging', () => {
  const booked = { completed: true, facts: { test_type: DEMO_TEST_NAME }, history: [] };
  assert.equal(classifyDemoOutcome(booked), 'booked_demo');

  const bookedOther = { completed: true, facts: { test_type: 'Blood Draw' }, history: [] };
  assert.equal(classifyDemoOutcome(bookedOther), 'tested_only');

  const justAsked = { completed: false, facts: {}, history: [{}, {}, {}] };
  assert.equal(classifyDemoOutcome(justAsked), 'requested_info');

  const barelyConnected = { completed: false, facts: {}, history: [{}] };
  assert.equal(classifyDemoOutcome(barelyConnected), null, 'one history entry is not a real signal');

  assert.equal(classifyDemoOutcome(null), null);
});

test('demo lead: captureDemoLead writes a real Mission Control lead for a booked demo', async () => {
  const store = createMemoryStore();
  const tenant = { id: 'sunrise-demo', isDemoTenant: true, labName: 'Sunrise Diagnostics' };
  const session = {
    from: CALLER,
    completed: true,
    facts: { test_type: DEMO_TEST_NAME, date: '2026-07-09', time_slot: '10:00' },
    history: [{}, {}, {}, {}],
  };

  await captureDemoLead(store, tenant, session);

  assert.equal(store.leads.length, 1);
  assert.equal(store.leads[0].stage, 'demo_scheduled');
  assert.equal(store.leads[0].phone, CALLER);
  assert.match(store.leads[0].note, /outcome: booked_demo/);
  assert.equal(store.leads[0].next_at, new Date('2026-07-09T10:00:00').toISOString());
});

test('demo lead: a caller who tries a fake booking but never books time with Amanda lands in "new", not "demo_scheduled"', async () => {
  const store = createMemoryStore();
  const tenant = { id: 'sunrise-demo', isDemoTenant: true, labName: 'Sunrise Diagnostics' };
  const session = {
    from: CALLER, completed: true,
    facts: { test_type: 'Lipid Panel', date: '2026-07-09', time_slot: '10:00' },
    history: [{}, {}],
  };

  await captureDemoLead(store, tenant, session);

  assert.equal(store.leads[0].stage, 'new');
  assert.match(store.leads[0].note, /outcome: tested_only/);
  assert.equal(store.leads[0].next_at, null, 'only a real Amanda booking sets next_at');
});

test('demo lead: a session with no real signal captures nothing', async () => {
  const store = createMemoryStore();
  const tenant = { id: 'sunrise-demo', isDemoTenant: true };
  await captureDemoLead(store, tenant, { from: CALLER, completed: false, facts: {}, history: [] });
  assert.equal(store.leads.length, 0);
});

test('demo lead: end-to-end through the engine — booking the demo slot and hanging up captures a lead', async () => {
  const store = createMemoryStore();
  const demoTenant = {
    id: 'sunrise-demo', labName: 'Sunrise Diagnostics', timezone: 'America/New_York',
    openHour: 9, closeHour: 17, slotCapacity: 1, isDemoTenant: true,
    systemPromptOverride: 'You are Kesa for Sunrise Diagnostics. Today is {todayISO}.',
    testCatalog: [{ code: 'PRODUCT_DEMO', name: DEMO_TEST_NAME, duration_min: 15 }],
  };
  const generateFn = scriptedModel([
    {
      functionCalls: [{
        name: 'book_appointment',
        args: {
          patient_name: 'Prospect Pat', phone_number: CALLER, test_type: DEMO_TEST_NAME,
          date: THURSDAY, time_slot: '10:00',
        },
      }],
    },
  ]);
  const engine = createEngine({ store, tenant: demoTenant, generateFn, now: NOW });

  const { tenant, session } = await engine.processTurn({
    channel: 'voice', from: CALLER, text: `book me the ${DEMO_TEST_NAME}`,
  });
  assert.equal(session.completed, true);

  engine.endSession('voice', CALLER, tenant);
  await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget capture land

  assert.equal(store.leads.length, 1);
  assert.equal(store.leads[0].stage, 'demo_scheduled');
});

test('demo lead: a real patient tenant ending a session never touches leads', async () => {
  const store = createMemoryStore();
  const engine = createEngine({ store, tenant: TENANT, generateFn: scriptedModel([{ text: 'ok' }]), now: NOW });

  const { tenant } = await engine.processTurn({ channel: 'voice', from: CALLER, text: 'hi' });
  assert.equal(tenant.isDemoTenant, undefined, 'sanity: TENANT fixture has no demo flag');

  engine.endSession('voice', CALLER, tenant);
  await new Promise((r) => setTimeout(r, 0));

  assert.equal(store.leads.length, 0);
});

test('demo lead: a silent hangup (no explicit end) is still captured, via the idle sweep', async () => {
  const store = createMemoryStore();
  const { captureDemoLead: capture } = require('../src/services/leads');
  const sessions = createSessionStore({ ttlMs: 5 }); // short expiry for the test
  const demoTenant = { id: 'sunrise-demo', isDemoTenant: true };

  const session = sessions.get('sunrise-demo:voice', CALLER, 'sunrise-demo');
  session.completed = true;
  session.facts.test_type = DEMO_TEST_NAME;
  session.facts.date = '2026-07-09';
  session.facts.time_slot = '10:00';

  // A real async wait (not a busy-wait — this test is already async, and a
  // generous margin here is cheap) so the TTL has unambiguously lapsed.
  await new Promise((r) => setTimeout(r, 30));

  const evicted = [];
  sessions.sweep((s) => evicted.push(s));
  assert.equal(evicted.length, 1);
  assert.equal(evicted[0].tenantId, 'sunrise-demo');

  await capture(store, demoTenant, evicted[0]);
  assert.equal(store.leads.length, 1);
  assert.equal(store.leads[0].stage, 'demo_scheduled');
});

// ══════════════════════════════════════════════════════════════
// 13. CALENDAR INVITES — .ics builder, signed download link
// ══════════════════════════════════════════════════════════════
const { buildIcsContent, buildIcsUrl, signToken, verifyToken } = require('../src/services/calendarInvite');

test('calendarInvite: buildIcsContent produces a valid VEVENT with the right start/end/duration', () => {
  const appointment = {
    id: 42, patient_name: 'Alex', test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
  };
  const ics = buildIcsContent({ tenant: TENANT, appointment });
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /UID:booking-42@test-lab\.ekaabo/);
  assert.match(ics, /SUMMARY:Lipid Panel — BrightPath Diagnostics/);
  // America/New_York is UTC-4 in July (EDT) — 10:00 local = 14:00Z.
  // Lipid Panel is 15 minutes in DEFAULT_TEST_CATALOG.
  assert.match(ics, /DTSTART:20260709T140000Z/);
  assert.match(ics, /DTEND:20260709T141500Z/);
});

test('calendarInvite: signToken/verifyToken round-trip; tampering or a mismatched tenant/id is rejected', () => {
  const token = signToken('test-lab', 42);
  assert.equal(verifyToken('test-lab', 42, token), true);
  assert.equal(verifyToken('test-lab', 42, token + 'x'), false);
  assert.equal(verifyToken('other-tenant', 42, token), false);
  assert.equal(verifyToken('test-lab', 99, token), false);
});

test('calendar route: a validly signed link serves the .ics file; a bad token or unknown booking 404s', async () => {
  const store = createMemoryStore();
  const saved = await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });
  const engine = createEngine({ store, tenant: TENANT, generateFn: scriptedModel([]), now: NOW });
  const bundle = createApp({ engine });
  const { server, port } = await startServer(bundle);
  try {
    const goodUrl = buildIcsUrl(TENANT, saved);
    const ok = await getPath(port, goodUrl.slice(goodUrl.indexOf('/calendar')));
    assert.equal(ok.status, 200);
    assert.match(ok.body, /BEGIN:VCALENDAR/);

    const bad = await getPath(port, `/calendar/${saved.id}.ics?tenant=${TENANT.id}&t=wrongtoken`);
    assert.equal(bad.status, 404);

    const missing = await getPath(port, `/calendar/999.ics?tenant=${TENANT.id}&t=${signToken(TENANT.id, 999)}`);
    assert.equal(missing.status, 404);
  } finally {
    server.close();
  }
});

test('booking confirmation: text channels get the calendar link appended; voice gets a follow-up SMS instead', async () => {
  const store = createMemoryStore();

  // SMS/WhatsApp: link rides in the reply itself.
  const textEngine = createEngine({ store, tenant: TENANT, generateFn: alexBookingScript(), now: NOW });
  const textResult = await textEngine.processTurn({ channel: 'whatsapp', from: `whatsapp:${CALLER}`, text: ALEX_UTTERANCE });
  assert.match(textResult.reply, /Add to your calendar: .*\/calendar\/\d+\.ics\?tenant=test-lab&t=/);

  // Voice: nothing useful to tap mid-call — a follow-up SMS carries the link instead.
  const sent = [];
  const voiceEngine = createEngine({
    store, tenant: TENANT, generateFn: alexBookingScript(), now: NOW,
    sendCalendarSms: async (to, body, from) => { sent.push({ to, body, from }); },
  });
  const voiceResult = await voiceEngine.processTurn({ channel: 'voice', from: CALLER, text: ALEX_UTTERANCE });
  assert.doesNotMatch(voiceResult.reply, /calendar/i);
  await waitFor(() => sent.length >= 1);
  assert.equal(sent[0].to, CALLER);
  assert.match(sent[0].body, /\/calendar\/\d+\.ics\?tenant=test-lab&t=/);
});

// ══════════════════════════════════════════════════════════════
// 14. APPOINTMENT REMINDERS — poller, lead-time window, no double-send
// ══════════════════════════════════════════════════════════════
const { runReminderSweep } = require('../src/services/reminders');

test('reminders: an appointment inside the lead window gets texted once and marked sent', async () => {
  const store = createMemoryStore();
  // 10:00 America/New_York on THURSDAY = 14:00Z. "Now" 90 minutes before,
  // well inside the default 24h lead window.
  const now = new Date('2026-07-09T12:30:00Z');
  const saved = await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const sent = [];
  const result = await runReminderSweep({
    store,
    getTenant: async () => TENANT,
    send: { sendSms: async (to, body, from) => sent.push({ to, body, from }) },
    now,
  });

  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, CALLER);
  assert.match(sent[0].body, /Reminder:.*Lipid Panel.*BrightPath Diagnostics/);

  const row = await store.getAppointmentById(TENANT.id, saved.id);
  assert.ok(row.reminder_sent_at, 'reminder_sent_at must be stamped');

  // A second sweep at the same instant must not resend.
  sent.length = 0;
  const again = await runReminderSweep({
    store, getTenant: async () => TENANT,
    send: { sendSms: async (to, body, from) => sent.push({ to, body, from }) },
    now,
  });
  assert.equal(again.sent, 0);
  assert.equal(sent.length, 0);
});

test('reminders: an appointment outside the lead window (or already past) is left alone', async () => {
  const store = createMemoryStore();
  await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const sendSms = async () => { throw new Error('must not be called'); };

  // Two days before the slot — outside the default 24h lead window.
  const tooEarly = await runReminderSweep({
    store, getTenant: async () => TENANT, send: { sendSms }, now: new Date('2026-07-07T12:00:00Z'),
  });
  assert.equal(tooEarly.sent, 0);

  // An hour after the slot already happened.
  const tooLate = await runReminderSweep({
    store, getTenant: async () => TENANT, send: { sendSms }, now: new Date('2026-07-09T15:00:00Z'),
  });
  assert.equal(tooLate.sent, 0);
});

test('reminders: two-touch sequence — day-before text with the calendar link, then a short same-day nudge, then silence', async () => {
  const store = createMemoryStore();
  const saved = await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });
  const sent = [];
  const send = { sendSms: async (to, body, from) => sent.push({ to, body, from }) };

  // 20h before the slot (10:00 EDT = 14:00Z): day-before touch only.
  const first = await runReminderSweep({
    store, getTenant: async () => TENANT, send, now: new Date('2026-07-08T18:00:00Z'),
  });
  assert.equal(first.sent, 1);
  assert.match(sent[0].body, /Add to calendar: .*\/calendar\/\d+\.ics/);
  let row = await store.getAppointmentById(TENANT.id, saved.id);
  assert.ok(row.reminder_sent_at, 'day-before touch stamped');
  assert.ok(!row.reminder_sameday_sent_at, 'same-day touch must NOT be stamped yet');

  // 75 min before: the same-day nudge — short, no link.
  const second = await runReminderSweep({
    store, getTenant: async () => TENANT, send, now: new Date('2026-07-09T12:45:00Z'),
  });
  assert.equal(second.sent, 1);
  assert.match(sent[1].body, /is today at 10:00/);
  assert.doesNotMatch(sent[1].body, /\.ics/, 'same-day nudge carries no link');
  row = await store.getAppointmentById(TENANT.id, saved.id);
  assert.ok(row.reminder_sameday_sent_at, 'same-day touch stamped');

  // Both touches sent — nothing more, ever.
  const third = await runReminderSweep({
    store, getTenant: async () => TENANT, send, now: new Date('2026-07-09T13:00:00Z'),
  });
  assert.equal(third.sent, 0);
  assert.equal(sent.length, 2);
});

test('reminders: a booking made inside the same-day window gets ONE text stamped as both touches', async () => {
  const store = createMemoryStore();
  const saved = await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });
  const sent = [];
  // 90 min out, neither touch sent yet — same-day wins, both stamp.
  const result = await runReminderSweep({
    store, getTenant: async () => TENANT,
    send: { sendSms: async (to, body, from) => sent.push({ to, body, from }) },
    now: new Date('2026-07-09T12:30:00Z'),
  });
  assert.equal(result.sent, 1);
  assert.equal(sent.length, 1);
  const row = await store.getAppointmentById(TENANT.id, saved.id);
  assert.ok(row.reminder_sent_at && row.reminder_sameday_sent_at, 'one text, both touches stamped');
});

test('reminders: an opted-out number receives no reminder texts (TCPA covers system-initiated sends too)', async () => {
  const store = createMemoryStore();
  await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'sms', status: 'confirmed', created_at: NOW.toISOString(),
  });
  await store.setOptOut(TENANT.id, CALLER, true);

  const result = await runReminderSweep({
    store, getTenant: async () => TENANT,
    send: { sendSms: async () => { throw new Error('must not send to an opted-out number'); } },
    now: new Date('2026-07-09T12:30:00Z'),
  });
  assert.equal(result.sent, 0);
});

test('reminders: a whatsapp-channel booking is reminded over WhatsApp, from the tenant WhatsApp number', async () => {
  const store = createMemoryStore();
  const waTenant = { ...TENANT, whatsappNumber: 'whatsapp:+15550009999' };
  await store.insertAppointment({
    tenant_id: waTenant.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'whatsapp', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const waSent = [];
  const smsSent = [];
  const result = await runReminderSweep({
    store, getTenant: async () => waTenant,
    send: {
      sendSms: async (to, body, from) => smsSent.push({ to, body, from }),
      sendWhatsApp: async (to, body, from) => waSent.push({ to, body, from }),
    },
    now: new Date('2026-07-09T12:30:00Z'),
  });

  assert.equal(result.sent, 1);
  assert.equal(smsSent.length, 0);
  assert.equal(waSent.length, 1);
  assert.equal(waSent[0].from, waTenant.whatsappNumber);
});

// ══════════════════════════════════════════════════════════════
// 15. ATTENDANCE + RETURNING-PATIENT HISTORY
// ══════════════════════════════════════════════════════════════
test('history: find_my_appointments returns aggregate visit counts for a returning caller, never an itemized log', async () => {
  const store = createMemoryStore();
  // Past visits: two attended, one no-show, one cancelled (excluded).
  const past = [
    { date: '2026-06-10', status: 'completed' },
    { date: '2026-07-01', status: 'completed' },
    { date: '2026-06-20', status: 'no_show' },
    { date: '2026-06-25', status: 'cancelled' },
  ];
  for (const p of past) {
    await store.insertAppointment({
      tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
      test_type: 'Blood Draw', date: p.date, time_slot: '09:00',
      channel: 'voice', status: p.status, created_at: NOW.toISOString(),
    });
  }
  // Plus one upcoming booking.
  await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: THURSDAY, time_slot: '10:00',
    channel: 'voice', status: 'confirmed', created_at: NOW.toISOString(),
  });

  const toolExecutor = createToolHandlers({ store, tenant: TENANT });
  const result = await toolExecutor.execute('find_my_appointments', {}, {
    tenant: TENANT, callerPhone: CALLER, now: NOW,
  });

  assert.equal(result.appointments.length, 1, 'upcoming list is unchanged');
  assert.deepEqual(result.history, {
    past_appointments: 3, // cancelled excluded
    attended: 2,
    missed: 1,
    last_attended_date: '2026-07-01',
  });

  // A first-time caller gets no history block at all.
  const fresh = await toolExecutor.execute('find_my_appointments', {}, {
    tenant: TENANT, callerPhone: '+15559990000', now: NOW,
  });
  assert.equal(fresh.history, undefined);
});

test('tenant freshness: getTenantById prefers the DB row over the env default, even for the default id', async () => {
  const store = createMemoryStore();
  // Simulate a console rename: the DB row for the SAME id the engine booted
  // with carries a different lab name than the env config.
  store.getTenantById = async (id) =>
    id === TENANT.id ? { ...TENANT, labName: 'Downtown Facility' } : null;

  const engine = createEngine({ store, tenant: TENANT, generateFn: scriptedModel([]), now: NOW });
  const resolved = await engine.getTenantById(TENANT.id);
  assert.equal(resolved.labName, 'Downtown Facility',
    'calendar links and reminders must see the renamed lab, not the env value');

  // No DB row at all (e.g. memory store) still falls back to the env tenant.
  const bare = createEngine({
    store: createMemoryStore(), tenant: TENANT, generateFn: scriptedModel([]), now: NOW,
  });
  assert.equal((await bare.getTenantById(TENANT.id)).labName, TENANT.labName);
});

test('prompt: the model is told NOT to re-introduce itself — the system greeting/disclosure already did', () => {
  const { buildSystemPrompt } = require('../src/services/gemini');
  const prompt = buildSystemPrompt(TENANT, '2026-07-04');
  assert.match(prompt, /do NOT introduce yourself again/);
  assert.match(prompt, /Never claim or imply you are human/);
});

test('attendance: updateAppointmentStatus moves confirmed → completed / no_show and out of capacity counts', async () => {
  const store = createMemoryStore();
  const saved = await store.insertAppointment({
    tenant_id: TENANT.id, patient_name: 'Alex', phone_number: CALLER,
    test_type: 'Lipid Panel', date: '2026-07-03', time_slot: '10:00',
    channel: 'voice', status: 'confirmed', created_at: NOW.toISOString(),
  });

  await store.updateAppointmentStatus(TENANT.id, saved.id, 'no_show');
  assert.equal((await store.getAppointmentById(TENANT.id, saved.id)).status, 'no_show');
  assert.equal(await store.countBookings(TENANT.id, '2026-07-03', '10:00'), 0,
    'marked rows stop counting against capacity');

  // And it lands in history as a miss.
  const history = await store.pastAppointments(TENANT.id, CALLER, '2026-07-04');
  assert.equal(history.length, 1);
  assert.equal(history[0].status, 'no_show');
});
