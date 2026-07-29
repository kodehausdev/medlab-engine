-- Appointment reminders (services/reminders.js). One column: the timestamp
-- a reminder text was sent, so the poller never double-sends. Null means
-- "not sent yet" — every existing row is unaffected.

alter table appointments add column if not exists reminder_sent_at timestamptz;

create index if not exists idx_appointments_reminder_pending
  on appointments (date) where status = 'confirmed' and reminder_sent_at is null;
