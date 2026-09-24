# Reviewed invoice revenue repair — 2026-09-24

This source candidate has not itself established a production repair. Local
fixtures, a GitHub commit, and a UI preview are not production acceptance.

Use the protected `database_revenue_repair_20260924` phase with the exact
`migration_versions` value `20260924074010`. Every reviewed predecessor through
`20260922133752`, plus the adopted production-ledger source `20260924043205`,
must already be installed. That HR directory migration was recovered byte-for-byte
from the immutable production ledger and is verified by a separate read-only
postflight; the revenue release does not run it again. The separate security phase and
`frontend_compat` remain valid before this repair so their deployment does not
silently approve a monetary change. Historical release phases cannot publish
this candidate.

The single atomic migration adds the narrowly scoped missing home-care rule for
one company/department and invokes the existing guarded revenue writer for the
two reviewed fully approved invoices. It recognizes 1,046,512 of revenue and an
equal receivable in August, leaving the exact original September cash receipt
rows untouched. It never recognizes the twelve pending-delivery invoices.
Changed source dates, amounts, accounts, approvals, cash evidence, a closed
period, conflicting entries, or unexpected rules abort the whole repair. A
repeat must not add entries or change source versions.

The same migration corrects the missing-revenue detector: receipt/cash entries
alone no longer count as invoice revenue. It accepts only the reviewed V2 body,
preserves HR/Google/tenant scope and execution ACLs, and checks the resulting
body. Dashboard and HR postflights select the precise old or new body according
to the installed migration ledger. Neither a new ledger with old code, new code
without its ledger, incomplete HR predecessors, nor body drift is accepted.

The protected release checks 24 prerequisite postflights, takes the advisory and
migration-ledger locks, verifies the exact ledger, and runs the full migration
and ledger insertion in one transaction. Rehearsal runs all 25 postflights and
eight read-only canary cores before rolling back. The complete inherited
HR/auth/storage/business fingerprint additionally covers revenue rules. Apply
uses the same locks and all 25 postflights. Failure at any boundary must preserve
the previous state. Recovery of an already applied version is read-only.

The database completion and production promotion gates both run the additional
revenue canary. It verifies exactly two repaired sources, four balanced revenue
rows, the exact four original receipt rows, and the rule scope. Public output
contains only aggregate success markers, not customer names or identifiers.
Canaries do not create employee sessions or operational transactions.

Local acceptance:

- The source repair suite executes the existing PostgreSQL writer with anonymous
  fixture invoices, including closed periods, source drift, partial postings,
  competing rules, negative approvals, cash drift, and trigger side effects.
- The actual V2 suite reproduces cash-only invoices masking missing revenue and
  verifies tenant/role isolation, no inferred income, and unchanged money.
- The full migration integration executes the untrimmed candidate through the
  protected renderer with the real writer, V2 body, and final repair postflight;
  a late postflight failure restores money, source, rules, function ACL/body,
  and ledger. Its 24 historical prerequisite checks use compact placeholders;
  each historical module is independently covered by its full-schema suite.
- Protected renderer failure injection covers every postflight/canary and
  rollback boundary, exact lineage, source preservation, and recovery.
- The complete HR fixture and dashboard fixture test old/new versioned pins and
  reject mismatched versions while preserving the existing HR checks.

Production acceptance must additionally retain the protected workflow results,
read-only proofs, unchanged receipt comparison, and deployed manifest. The
repair amount does not imply a final full-company revenue figure: other
uncompleted workflows remain separate from recognized ledger income.
