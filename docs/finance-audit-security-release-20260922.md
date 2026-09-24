# Finance 2026-09-22 audit security release

This candidate fixes the audited document-access, attachment, transaction-recovery,
export, and browser-interaction defects. Local fixture tests and a GitHub upload
are not proof of production deployment or successful Google OAuth for real staff.

The protected workflow accepts these current-candidate pairs. Publish in order:
apply the security batch, repair the reviewed revenue sources, then promote the
compatible UI. Each database step has its own exact-version phase and canaries:

| Phase | Migration versions | Preconditions |
| --- | --- | --- |
| `database_audit_security_20260922` | `20260922133752` | Every earlier reviewed migration, including the complete `20260922072109,20260922072737,20260922075604` HR batch, is already recorded. The later adopted HR directory source is separately verified read-only. |
| `database_revenue_repair_20260924` | `20260924074010` | Every predecessor including `20260922133752` and adopted HR directory source `20260924043205`; see [the revenue release contract](finance-revenue-repair-release-20260924.md). |
| `frontend_compat` | `none` | The complete reviewed chain including security, HR directory adoption `20260924043205`, and revenue repair is already recorded. |

Historical HR and AR renderers remain available for their reviewed candidates and
fixture regression checks. They cannot publish this candidate: choosing an older
phase must fail validation rather than skip its security dependency. If HR is
missing, first complete the separately reviewed HR release; do not bypass ledger
checks, rename versions, or publish the new UI through an old phase.

The release uses the sealed candidate tools and complete SQL source. The database
step verifies all 22 predecessor postflights before rehearsal. Rehearsal takes the
release advisory lock and migration-ledger lock, verifies the exact ledger, runs
the migration and ledger insertion together, then runs all 24 postflights and
seven read-only canary cores. It rolls back to the savepoint and verifies every
canary rollback assertion plus an unchanged database fingerprint. Apply uses the
same lock, exact-ledger assertion, migration, ledger insertion, and all 24
postflights in one transaction. Missing files, partial prerequisites, changed
ledgers, or any postflight failure fail closed and preserve the previous state.

After apply (or recovery of an already-applied release), the read-only contracts
are checked again. Both database completion and the final promotion gate require
these seven canaries: dashboard scope, Google identity projection, approval
search, approval history summary, invoice select scope, receivable accounting
scope, and audit identity/attachment security. The current phase does not set
employee JWT claims or run canaries that create operational transactions.

The fingerprint retains the complete HR schema/business-data coverage and adds
Storage schema privileges, policies, objects, buckets, file metadata, and optional
`private.finance_legacy_attachment_links_v1` rows. It includes the dedicated
`finance_attachment_private` namespace owner/ACL and helper definitions/ACLs,
as well as index definitions, expressions, and predicates. An absent-before-install legacy
link table is a valid fingerprint state and must be restored by rehearsal.
Only digests are returned; attachment paths and employee data are not emitted.

Acceptance gates:

- `pnpm release:preflight` includes actual isolated SQL/RLS access cases, income
  and receipt retry/recovery cases, exported-file integrity, and protected-batch
  failure injection at every postflight and canary boundary. Versioned invoice
  and AR helper pins reject both a new ledger with old code and new code without
  its ledger version; they also reject unexpected helper-body drift.
- `pnpm test:finance-ui-interactions` drives the actual browser DOM at 1440 and
  390 pixels using fictional identities. It covers live and composed AR search,
  selection keys, modal keyboard isolation, desktop column sorting, and stale
  navigation after draft save or identity changes. Mobile retains its existing
  card layout. DOM composition events do not claim a real OS IME or OAuth test.
- Protected candidate CI installs pinned Chromium before the browser test. The
  UI fixture performs no production writes and calls no external services.
- Promotion must use the exact sealed commit/deployment and retain the existing
  artifact, production-target, and manifest checks.

Production completion still requires the protected workflow and inspection of
the deployed manifest plus real authorized user acceptance. This document does
not claim that deployment has occurred.
