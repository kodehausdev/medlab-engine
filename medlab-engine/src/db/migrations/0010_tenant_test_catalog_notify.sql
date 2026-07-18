-- Per-tenant test catalog (console-editable in Settings) and notification
-- contacts (where #20's emergency paging will send, once wired up — this
-- migration only adds the columns, nothing sends yet).
--
-- test_catalog null/empty means "use the default six tests" — see
-- medlab-engine/src/services/tools/schemas.js's DEFAULT_TEST_CATALOG.

alter table tenants add column if not exists test_catalog jsonb;
alter table tenants add column if not exists notify_email text;
alter table tenants add column if not exists notify_sms_number text;
