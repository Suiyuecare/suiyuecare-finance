# Daycare direct-department Finance summary (draft)

This is a **non-deployed draft PR**. The SQL is versioned in
`supabase/migrations/` so the repository's source-integrity and lineage gates
can review it, but it has not been applied to any managed database. No binding
row, credential, Edge Function, or production database change is included. Do
not enable the Daycare `FINANCE_STORE_*` settings from this branch.

## Scope and contract

`POST /functions/v1/daycare-store-finance-summary` is server-to-server only.
The Daycare server sends a dedicated bearer token and exactly four JSON fields:
`request_id`, `organization_id`, `branch_id` (UUIDs), and `month` (`YYYY-MM`).
The request cannot choose Finance tenant, entity, or department. The token's
server-side `FINANCE_DAYCARE_SUMMARY_BINDING_ID` selects one reviewed, active,
unexpired private binding. The SQL rechecks its Daycare organization/branch and
the active Finance posting-unit/entity-scope projection on every call.

A ready response includes the echoed request fields, `binding_id`, `entity_id`,
`department_code`, `scope_basis: "department_direct_only"`, `entity_name`,
`currency: "TWD"`, `basis: "finance_pnl_ledger"`, exact two-decimal `income`
and `expenses`, `entry_count`, and `generated_at`. The Edge layer projects only
those public fields. Daycare separately requires exact equality with its
branch-specific server configuration; a whole-entity response is rejected.
Missing configuration, invalid auth, ambiguous scope, a stale binding, or a
source error yields unavailable, never an invented zero.

The first approved **Wanhua branch** binding is Finance entity `E6`, posting
department `J1101`, earliest covered month July 2026. This pair is not
hard-coded globally: each later branch needs its own reviewed binding. The
proposal seeds **no binding**, including Wanhua's. Finance must verify the
actual Daycare organization/branch UUIDs and create the binding only after the
source and accounts are reconciled. All `C1100` history, including E2/C1100 and
E6/C1100, remains excluded until Finance reviews it line by line. Unassigned
shared costs and other departments are excluded without guessed allocation.

The SQL reads only `ledger_entries` rows for the binding's exact tenant,
`data_environment='production'`, entity, department, and half-open month,
with `voided_at IS NULL` and without period/year-end closing entries, as in
the Finance P&L engine. It trims account codes before grouping. It rejects a month if the same department has
non-void production rows in that tenant with another or missing entity. Both
`entry_count` and amounts use this same direct-row scope.
If an included month's direct rows lack an account code, debit, or credit, the
summary fails closed rather than silently undercounting; these columns are
nullable in the managed schema. Rows without a usable tenant or date require
separate historical reconciliation before activation, because they cannot be
assigned safely to a requested tenant/month.

Accounts beginning 4/7 contribute credit minus debit to income; 5/6/9 contribute debit minus
credit to expenses. Like the existing Finance statement engine, account-code
groups with absolute net < 0.005 are omitted. Signed reversals remain signed.
These account classes and the 0.005 rule are draft carryovers, not an approved
branch reporting policy; the Finance owner must explicitly approve them before activation.
The Finance statement engine also removes voided and closing rows before calculating P&L.
This proposed view differs in its exact direct-department scope and must be
reconciled for the same periods, entry by entry, before it is described as
verified income and expenses.

`ledger_entries` has no separate approval-state column. This is a booked-ledger
summary, **not** proof that every entry passed human approval, a cash-flow
statement, a full branch P&L, or a shared-cost allocation.

## Security and activation boundary

The proposed RPC is `STABLE SECURITY INVOKER` with an empty search path,
service-role-only execute, private binding RLS, no binding seed, and no grant
for ledger writes. The Edge Function accepts only its dedicated, expiring
64-character hex token; it rejects browser context, query strings, excess
bodies, redirects, and upstream payloads over 16 KiB. It does not log or
return source rows, raw errors, or secrets. Per-isolate throttling is only an
overload guard, not a durable global quota.

Read-only catalog inspection of the managed Finance PostgreSQL project found
the required tenant, private schema, ledger, and department-scope tables;
the proposed binding/RPC do **not** exist there. An existing ledger index on
`(tenant_id, data_environment, entity_id, entry_date)` may support the month
scan, with `department_code` as a residual filter. No new ledger index is
included before representative-volume plans and lock costs are reviewed.
The current service role has SELECT on the three source tables, but no new
privilege or secret was created during this inspection.
This inspection is feasibility evidence, **not** a managed-PG migration or
PostgREST/Edge runtime test.

Before activation, Finance release owners must approve the new lineage entry,
add it to the controlled release-phase catalog, and rehearse on a
disposable **managed** PostgreSQL clone, run security advisors and explain
plans, verify service-key/PostgREST and Deno behavior, compare direct monthly
totals including voids/reversals to reviewed ledger entries for the same periods,
approve the account-class and 0.005 semantics, and approve a
time-limited binding. Only then may they deploy this one function with its
custom server-to-server auth configuration and provision distinct Finance
Edge and Daycare server-only secrets. Do not change JWT verification for other
functions. Rollback is to deactivate the binding and rotate the dedicated
token; ledger data is never changed by this proposal.

Local synthetic checks (never a live connection):

```sh
node --test scripts/test_daycare_finance_summary.mjs
PGLITE_MODULE_PATH=/absolute/path/to/pglite/dist/index.js node scripts/test_daycare_finance_summary_sql.mjs
pnpm release:migration-lineage
```

The SQL fixture executes the draft migration in in-memory PGlite with synthetic
scope/ledger data and checks role privileges, cross-entity/department
rejection, void exclusion, and an HTTP-to-RPC-to-SQL round trip. It cannot
replace a native Supabase/PostgREST/Edge rehearsal.
