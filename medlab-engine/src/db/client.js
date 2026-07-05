// Datastore abstraction. When SUPABASE_URL is configured, appointments live
// in Postgres; otherwise an in-memory store backs local dev and the test
// suite. Both implement the same three methods, and BOTH are fed exclusively
// through hipaa.sanitizeAppointment() by the tool layer.

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

function createMemoryStore() {
  const appointments = [];
  const auditEvents = [];
  return {
    kind: 'memory',
    appointments, // exposed for test assertions
    auditEvents,  // exposed for test assertions

    async insertAppointment(record) {
      const row = { id: appointments.length + 1, ...record };
      appointments.push(row);
      return row;
    },

    async insertAuditEvent(row) {
      auditEvents.push({ id: auditEvents.length + 1, ...row });
    },

    async countBookings(tenantId, date, timeSlot) {
      return appointments.filter(
        a => a.tenant_id === tenantId && a.date === date &&
             a.time_slot === timeSlot && a.status === 'confirmed'
      ).length;
    },

    async bookingsOn(tenantId, date) {
      return appointments.filter(
        a => a.tenant_id === tenantId && a.date === date && a.status === 'confirmed'
      );
    },
  };
}

function createSupabaseStore() {
  const supabase = createClient(config.supabase.url, config.supabase.key);
  return {
    kind: 'supabase',

    async insertAppointment(record) {
      const { data, error } = await supabase
        .from('appointments').insert([record]).select().single();
      if (error) throw new Error(`Supabase insert failed: ${error.message}`);
      return data;
    },

    async insertAuditEvent(row) {
      const { error } = await supabase.from('audit_events').insert([row]);
      if (error) throw new Error(`Supabase audit insert failed: ${error.message}`);
    },

    async countBookings(tenantId, date, timeSlot) {
      const { count, error } = await supabase
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).eq('date', date)
        .eq('time_slot', timeSlot).eq('status', 'confirmed');
      if (error) throw new Error(`Supabase count failed: ${error.message}`);
      return count || 0;
    },

    async bookingsOn(tenantId, date) {
      const { data, error } = await supabase
        .from('appointments')
        .select('id, date, time_slot, test_type, status')
        .eq('tenant_id', tenantId).eq('date', date).eq('status', 'confirmed');
      if (error) throw new Error(`Supabase select failed: ${error.message}`);
      return data || [];
    },
  };
}

function createStore() {
  return config.supabase.url && config.supabase.key
    ? createSupabaseStore()
    : createMemoryStore();
}

module.exports = { createStore, createMemoryStore };
