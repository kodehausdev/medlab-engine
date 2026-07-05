-- MedLab AI Receptionist — Supabase schema
-- Deliberately minimal: the appointments table holds the ONLY patient data
-- this system stores. No transcripts, no free-text notes, no history fields.

create table if not exists tenants (
  id text primary key,                    -- e.g. 'default' or a slug
  lab_name text not null,
  twilio_number text,                     -- inbound number → tenant routing
  timezone text default 'America/New_York',
  open_hour int default 8,
  close_hour int default 17,
  slot_capacity int default 2,
  plan text default 'standard',           -- $297/mo standard
  created_at timestamptz default now()
);

-- Single-tenant MVP seed — matches the .env defaults. Multi-tenant onboarding
-- replaces this with real rows keyed by inbound Twilio number.
insert into tenants (id, lab_name)
  values ('default', 'BrightPath Diagnostics')
  on conflict (id) do nothing;

create table if not exists appointments (
  id bigint generated always as identity primary key,
  tenant_id text references tenants(id),
  patient_name text not null,
  phone_number text not null,
  test_type text not null,
  date date not null,
  time_slot text not null,                -- 'HH:MM' 24h
  channel text not null,                  -- 'voice' | 'whatsapp'
  status text default 'confirmed',        -- confirmed | cancelled | completed
  created_at timestamptz default now()
);

create index if not exists idx_appointments_slot
  on appointments (tenant_id, date, time_slot) where status = 'confirmed';

-- Audit log: the durable copy of the dashboard event stream
-- (services/events.js envelope). PHI-minimized at the source — phone numbers
-- reduced to a 4-digit tail, guardrail events carry no caller content.
create table if not exists audit_events (
  id bigint generated always as identity primary key,
  tenant_id text,
  event_id text,                          -- engine envelope id ('evt-7', per-process)
  type text not null,                     -- 'call.answered' | 'booking.confirmed' | 'guardrail.redacted'
  channel text default 'unknown',         -- 'voice' | 'whatsapp'
  phone_tail text,                        -- last 4 digits only
  data jsonb default '{}',                -- type-specific, whitelisted fields only
  created_at timestamptz default now()
);

create index if not exists idx_audit_events_tenant_time
  on audit_events (tenant_id, created_at desc);

-- Console realtime: stream INSERTs to subscribed dashboards.
alter publication supabase_realtime add table audit_events;

-- ── Row-level security ────────────────────────────────────────
-- The engine writes with the service-role key (bypasses RLS). The console
-- currently reads with the anon key: permissive read-only policies below are
-- a DEV posture — replace with tenant-scoped policies (JWT tenant_id claim)
-- at the Auth milestone, before any real lab's data lands here.
alter table tenants enable row level security;
alter table appointments enable row level security;
alter table audit_events enable row level security;

create policy "dev read tenants" on tenants for select using (true);
create policy "dev read appointments" on appointments for select using (true);
create policy "dev read audit_events" on audit_events for select using (true);
