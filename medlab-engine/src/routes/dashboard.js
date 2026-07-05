// Dashboard feed — read-only API consumed by the front-desk console
// (MedLab Dashboard.dc.html).
//   GET /api/dashboard/state   → { tenant, counters, recent } snapshot
//   GET /api/dashboard/events  → Server-Sent Events: buffer replay, then live
//
// SSE over WebSockets on purpose: the flow is strictly server → dashboard,
// EventSource reconnects for free, and it rides the existing Express server.
//
// ⚠ Unauthenticated and CORS-open for local development (the .dc.html opens
// from file://, so Origin is "null"). Events carry minimum-necessary data
// (patient name + phone tail only), but before exposing this beyond
// localhost put it behind auth and pin the allowed origin.

const express = require('express');

function createDashboardRouter({ engine }) {
  const router = express.Router();

  router.use('/api/', (_req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    next();
  });

  router.get('/api/dashboard/state', (_req, res) => {
    const { counters, recent } = engine.events.snapshot();
    const t = engine.tenant;
    res.json({
      tenant: {
        id: t.id,
        lab_name: t.labName,
        open_hour: t.openHour,
        close_hour: t.closeHour,
        slot_capacity: t.slotCapacity,
      },
      counters,
      recent,
    });
  });

  router.get('/api/dashboard/events', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable proxy buffering (nginx et al.)
    });
    if (res.flushHeaders) res.flushHeaders();

    const write = (event) => {
      res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    // Replay the ring buffer so a freshly opened console isn't blank,
    // then stream live events as the engine emits them.
    for (const event of engine.events.snapshot().recent) write(event);
    const unsubscribe = engine.events.subscribe(write);

    const heartbeat = setInterval(() => res.write(': hb\n\n'), 25000);
    if (heartbeat.unref) heartbeat.unref();

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}

module.exports = { createDashboardRouter };
