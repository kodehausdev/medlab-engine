-- Blocked scheduling windows (lunch, maintenance, staff meetings, holidays…).
-- A blocked slot is a HOLD ON NEW CAPACITY, not a cancellation — existing
-- confirmed appointments in that slot are untouched; check_availability and
-- book_appointment just stop offering/accepting it to the AI. Written by the
-- console (medlab-web, service-role key) and read by the engine the same way
-- appointments already are.
--
-- Walk-in holds need no new table: they're ordinary `appointments` rows with
-- channel = 'walk-in', written directly by the console — countBookings and
-- bookingsOn already include them with zero engine changes.

create table if not exists schedule_blocks (
  id bigint generated always as identity primary key,
  tenant_id text not null references tenants(id),
  date date not null,
  time_slot text not null,                -- 'HH:MM' 24h, matches appointments.time_slot
  reason text,
  created_by uuid,                        -- profiles.user_id of the operator who blocked it
  created_at timestamptz default now(),
  unique (tenant_id, date, time_slot)
);

create index if not exists idx_schedule_blocks_day
  on schedule_blocks (tenant_id, date);

alter table schedule_blocks enable row level security;

create policy "tenant members read their schedule blocks" on schedule_blocks
  for select to authenticated using (tenant_id = public.user_tenant_id());

-- No insert/update/delete policy on purpose, same as appointments: the
-- console writes through medlab-web server routes on the service-role key.
