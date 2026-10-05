-- READ ONLY: validate the deployed source, security properties, and existing ACL.
-- Compare ACL against the preflight snapshot; this migration never changes it.
select p.oid::regprocedure as function_signature,
       pg_catalog.encode(extensions.digest(p.prosrc::bytea, 'sha256'), 'hex') as source_sha256,
       pg_catalog.encode(extensions.digest(p.prosrc::bytea, 'sha256'), 'hex') =
         '060fc08af5f4002c017694cbaa572f6976964054c92be5265511a0dcb5f0067f' as matches_reviewed_patch,
       pg_catalog.pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer, p.proconfig, p.proacl
from pg_catalog.pg_proc p
where p.oid = 'public.finance_expense_act_active_step(text[],text,text,text,jsonb,text,jsonb,jsonb,text)'::regprocedure;

-- Existing direct-update trigger remains unchanged by this migration.
select pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) =
         'f339a09e1bdafb8ffc9e20ce2b103a88' as direct_update_guard_unchanged
from pg_catalog.pg_proc p
where p.oid = 'private.finance_expense_guard_direct_update()'::regprocedure;
