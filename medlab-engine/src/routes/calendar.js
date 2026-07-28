// Public .ics download for a confirmed appointment — the link texted to
// patients (services/calendarInvite.js). No login: gated by the signed
// token instead, since the recipient is an unauthenticated patient on SMS.

const express = require('express');
const { verifyToken, buildIcsContent } = require('../services/calendarInvite');
const { safeLog } = require('../compliance/hipaa');

function createCalendarRouter({ engine }) {
  const router = express.Router();

  router.get('/calendar/:id.ics', async (req, res) => {
    const id = Number(req.params.id);
    const tenantId = String(req.query.tenant || '');
    const token = String(req.query.t || '');

    if (!id || !tenantId || !verifyToken(tenantId, id, token)) {
      return res.status(404).type('text/plain').send('Not found');
    }

    try {
      const tenant = await engine.getTenantById(tenantId);
      if (!tenant) return res.status(404).type('text/plain').send('Not found');

      const appointment = await engine.store.getAppointmentById(tenantId, id);
      if (!appointment || appointment.status !== 'confirmed') {
        return res.status(404).type('text/plain').send('Not found');
      }

      const ics = buildIcsContent({ tenant, appointment });
      res.type('text/calendar').set('Content-Disposition', `attachment; filename="appointment-${id}.ics"`).send(ics);
    } catch (err) {
      safeLog(`❌ calendar .ics lookup failed: ${err.message}`);
      res.status(500).type('text/plain').send('Something went wrong');
    }
  });

  return router;
}

module.exports = { createCalendarRouter };
