# Internal audit preparation contract

This workspace is an internal PBC preparation checklist. It does not issue an audit opinion, perform statutory certification, file tax returns, close accounting periods, or archive source files.

## Scoped RPCs

- `finance_audit_case_read_v1(p_entity_id text,p_period text,p_data_environment text default 'production')`
- `finance_audit_case_save_v1(p_entity_id text,p_period text,p_expected_revision bigint,p_expected_source_fingerprint text,p_case_data jsonb,p_reason text,p_data_environment text default 'production')`
- `finance_audit_case_history_v1(p_entity_id text,p_period text,p_data_environment text default 'production')`

Select exactly one current company; `all` is rejected. A period is `YYYY`, `YYYY-MM`, or `YYYY-Q1` through `YYYY-Q4`. Production and test are distinct scopes.

Read/save return `{ok,entityId,period,revision,caseData,sourceFingerprint,currentFingerprint,sourceCounts,sourceAsOf,canEdit,actorId,updatedAt}`. The two fingerprint fields are aliases for the current server fingerprint. Missing cases return revision zero and twelve unknown/pending items. History returns `{ok,entityId,period,rows}` with the newest 100 immutable revisions; each row contains `{revision,caseData,sourceFingerprint,reason,actorId,createdAt}`. `actorId` is the server-resolved Finance ID, never a client-supplied signer name.

`caseData` contains `schemaVersion:1`, `engagementType:both|financial|tax`, nullable `legalForm`, `auditorName`, `engagementReference`, and exactly `items.A01` through `items.A12`. Each item has `ownerId`, `dueDate`, `evidenceReference`, `notes`, `sourceLinks`, `applicability:unknown|applicable|not_applicable`, `status:pending|provided|reviewed`, and the server-owned `preparedBy/preparedAt/reviewedBy/reviewedAt/reviewedFingerprint`. Source links are at most 30 unique `{sourceType:invoice|expense_request,sourceId}` objects per item.

## Authority and transitions

The existing verified reporting actor, saved reports permission and Membership company grants remain mandatory. `external_audit` and `board` cannot save; reading also requires every source row to be accessible under the existing invoice/request guards. Those roles alone do not grant complete company source access. `canEdit` follows the existing `canEditWorkpaper` capability; clients must use this server result. Owner selection requires an active Finance user in the same tenant and does not grant that owner access.

All case/history reads and saves recheck source links. Complete company fingerprints/counts additionally require visibility of every scoped invoice/request and each source department under the existing optional permission helper. Partial visibility fails with `42501`; hidden rows are not exposed through a complement count or fingerprint.

- `provided` or `reviewed` requires a nonempty evidence reference or at least one valid source link. `not_applicable` also requires notes explaining why. This does not validate the substance of external evidence.
- A changed business field establishes the current actor as preparer and clears the review. A simultaneous request to review changed content becomes `provided`; missing evidence can only remain `pending`.
- Changing engagement-level fields invalidates prior item reviews. Unrelated item changes preserve unchanged review metadata.
- Review requires an already provided item, confirmed applicability, and a current authorized actor different from its stored preparer. Unknown applicability permits preparation but cannot be reviewed. The server supplies reviewer/time and the independently calculated source fingerprint.
- A stale item is still stored as `reviewed` with its original fingerprint. UI must show it as requiring re-review. Ordinary roundtrips preserve that historical review. An explicit re-review action sets the input item's `reviewedFingerprint` to the current `sourceFingerprint`; this is only an action signal. The server recalculates the fingerprint, checks source CAS and reviewer authority, and owns the saved metadata.

Save requires a nonempty reason, exact case revision and current source fingerprint. The case advisory/row lock serializes revision updates; case and immutable audit revision are committed together. Conflicts return `40001` without partial case/audit mutation. The UI must update success state only after the RPC succeeds.

## As-of source comparison

The server computes SHA-256 from every row in the selected tenant/environment/company's `ledger_entries`, `invoices` and `expense_requests`, plus its `finance_reporting_profiles` row, in one statement snapshot. Counts cover all corresponding source rows, including voided and future rows. The selected checklist period does not truncate the fingerprint; later changes conservatively invalidate reviews in all that company's cases.

This detects row changes, including same-count edits and source attachment metadata changes. It does not hash object bytes in Storage, make a source immutable, prevent later transactions, or certify completeness beyond the current authorized source tables. Existing source rows, posted vouchers, journal entries and period locks are never mutated by these RPCs. Read does not rewrite stale review history.

The private case and revision tables have RLS and no direct PUBLIC/anon/authenticated/service_role grants. Revisions reject UPDATE and DELETE. Only the three scoped public RPCs are granted to authenticated.

## Local/release verification

`scripts/check_finance_audit_readiness.cjs` executes the real new SQL, prior reporting authority, and existing optional Membership helper against anonymous PostgreSQL fixtures. Its reusable fixture is `createAuditReadinessFixture(db,{install:false})` in `scripts/fixtures/finance_audit_readiness_fixture.cjs`.

The protected release uses `20260911151054_finance_audit_readiness_v1.sql`, its read-only postflight, full previous database fingerprint plus optional new private tables, and a rollback-only authenticated canary with separate preparer/reviewer/ordinary-reader boundaries. Passing automation is not evidence of a human CPA review or a production deployment.
