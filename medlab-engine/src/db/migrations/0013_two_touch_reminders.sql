-- Two-touch reminders + attendance tracking.
--
-- 1. Second reminder touch: the day-before text (0012's reminder_sent_at)
--    is joined by a short same-day nudge a couple of hours before the slot
--    (services/reminders.js, REMINDER_SAMEDAY_LEAD_HOURS). Tracked in its
--    own column so each touch fires exactly once.
alter table appointments add column if not exists reminder_sameday_sent_at timestamptz;

-- Pending now means "either touch unsent" — replace 0012's partial index.
drop index if exists idx_appointments_reminder_pending;
create index if not exists idx_appointments_reminder_pending
  on appointments (date)
  where status = 'confirmed'
    and (reminder_sent_at is null or reminder_sameday_sent_at is null);

-- 2. Attendance: no schema change needed — appointments.status is free text.
--    The console's attendance marking (medlab-web api/scheduling/attendance)
--    moves past bookings confirmed → completed | no_show. Documented here so
--    the value set is written down somewhere migration-shaped:
--    confirmed | cancelled | completed | no_show
