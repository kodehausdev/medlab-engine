-- Public sales demo tenant (sunrise-demo) support. A prompt swap, not a
-- fork: is_demo_tenant + system_prompt_override are the only new columns —
-- the demo tenant is otherwise an ordinary row (test_catalog, open/close
-- hours, etc. all already exist from prior migrations) and runs through the
-- exact same engine, tools, and guardrails as any real tenant.

alter table tenants add column if not exists system_prompt_override text;
alter table tenants add column if not exists is_demo_tenant boolean not null default false;
