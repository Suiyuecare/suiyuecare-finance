# Canonical receivables RPC contract

Migration: `20260910064324_finance_canonical_receivables_v1.sql`. All RPCs require a verified active Finance identity, use the current tenant, and preserve `can_read_invoice` per-record scope. No browser fallback may derive received amounts from `paid`/`partial` status.

## Read

`finance_receivables_v1(p_as_of date, p_entity_id text = null, p_department_code text = null, p_data_environment text = 'production') -> jsonb`

Response `{version:1, asOf, complete:true, totalCount, items, summary, buckets, reconciliation}`. All authorized invoices through `p_as_of` are returned, including settled and unrecognized invoices; no silent cap. The UI may filter its worklist but must use the returned scope consistently.

Each item: `invoiceId`, `invoiceNo`, `batchId`, `entityId`, `departmentCode`, `buyer`, `invoiceDate`, `dueDate` (nullable), `dueSource` (`manual|source_bill|unknown`), `originalAmount`, `recognizedAmount`, `arAllowanceAmount`, `allowanceAmount`, `receivedAmount`, `outstandingAmount` (signed official ledger balance), `unrecognizedAmount`, `refundPayable`, `refundedAmount`, `pendingReceiptAmount`, `pendingReceiptDate`, `status` (stored workflow), `balanceStatus` (`unrecognized|unpaid|partial|settled|credit`), `rowVersion`, `metadataVersion`, `agingBucket` (`unknown|not_due|d1|d31|d61|d90|settled`), `overdueDays` (nullable), `ownerId`, `ownerName`, `lastContact`, `nextActionDate`, `notes`, `sourceRefs`, `needsReconciliation`, `refundEvents`.

Summary: `originalAmount`, `recognizedAmount`, `arAllowanceAmount`, `allowanceAmount`, `receivedAmount`, `outstandingAmount` (positive balances only), `creditAmount`, `unrecognizedAmount`, `pendingReceiptAmount`, `refundPayable`, `refundedAmount`, `overdueAmount`, `over90Amount`, `unknownDueAmount`. Buckets have `key,label,total,count`. Reconciliation preserves the signed mapped invoice net. Complete scoped ledger totals require the verified reconciliation authority described below; insufficient authority yields null, never a confirmed zero. No unrelated unauthorized invoice totals are exposed to employees.

`allowanceAmount` is the full posted allowance/void amount, while `arAllowanceAmount` is only the portion credited to receivables (1123). Always display `outstandingAmount` directly: after recognition 100, receipt 40, and full allowance 100, the result is `allowanceAmount=100`, `arAllowanceAmount=60`, `outstandingAmount=0`, `refundPayable=40`. Subtracting the full allowance and received amount would incorrectly show a negative receivable.

`refundEvents` is the complete current actionable refund worklist for the invoice: `{id,eventNo,type,date,total,refundPayableAmount,refundAmount,remaining,voucherId,voucherNo,status}`. Its cumulative `refundAmount` supplies refund CAS; it deliberately represents current operation state even when the balance report uses an earlier cutoff. Label this section **current refund progress**, separate from as-of balance amounts. The as-of `refundedAmount` and `refundPayable` themselves reflect only installments through `p_as_of`.

`reconciliation` also returns `bankVisible`, `bankScope:'company'`, `unmatchedBankItems`, `unmatchedBankAmount`, `unmatchedBankCount`. Each item is `{id,date,entityId,amount,matchedAmount,remainingAmount,matchStatus,counterparty,referenceNo,description,matchCount,differenceFlag}`. There is no row cap. A bank inflow 100 with matching 40 remains pending 60 even if its stored status says matched. Department-filtered reads still show company bank scope because banks have no department allocation. Unauthorized bank readers receive `bankVisible=false`, `unmatchedBankItems=[]`, and null bank totals; do not render these as confirmed zero.

Dates come from explicitly saved metadata, then a matching tenant/environment/company source bill. Unknown dates stay unknown, not invoice-date-plus-30. Original posted journal rows are never rewritten by this migration.

## Receipt submission, approval and return

`finance_invoice_receipt_action_v2(p_invoice_ids text[], p_action text, p_idempotency_key text, p_expected_versions jsonb, p_note text = '', p_files jsonb = [], p_data_environment text = 'production', p_amounts jsonb = null, p_received_date date = null) -> jsonb`

- Same `submit|approve|return`, role checks, exact proof validation, expected invoice versions, all-or-nothing batch and response `{ok,count,rows,idempotent_replay}` as v1.
- On submit, `p_amounts` is either null (each invoice's entire collectible remaining balance) or an exact mapping `{invoiceId:positiveAmount}` with no extra/missing keys. No rounding silently changes user amounts; at most two decimals. `p_received_date` defaults to today in Asia/Taipei; cannot be future or earlier than the invoice date. One pending receipt per invoice.
- Approval/return must send `p_amounts=null,p_received_date=null`; they act on the reviewed stored amount/date, never edit them. Re-read first and display `pendingReceiptAmount` and `pendingReceiptDate` to the reviewer.
- Reuse the same key on uncertain retries with the same payload. Reusing it with any changed payload fails. Exact old v1 operation digests remain replayable.
- `finance_invoice_receipt_action_v1` retains its exact old signature and delegates to v2 with null new arguments. Existing pending v1 requests without an event are accepted only when the old reviewed full invoice amount still equals the collectible remaining balance; otherwise return/resubmit is required. Existing posted receipts are read from their actual ledger entries, not backfilled as fabricated events.
- Remaining > 0 after approval gives `status=partial`; zero gives `paid`. `partial` is now a protected receipt status. Existing attachment, accounting-period, revenue-recognition, identity and ledger guards remain in force.

## Refund

`refund_invoice_receipt_v2(p_lifecycle_event_id text, p_refund_amount numeric, p_reason text, p_refund_date date, p_bank_transaction_id text, p_idempotency_key text, p_expected_refund_amount numeric) -> jsonb`

Expected refund amount is the event's cumulative `refundAmount` last reviewed (zero initially). The operation locks the source invoice/event, checks authorized accountant/admin_director/CEO, creates one refund voucher and ledger pair per installment, and increments cumulative refund amount. Only fully refunded events become `refunded`; partial events remain `posted`. Same key retries replay; altered payloads and over-refunds fail. Optional bank transaction must be a scoped negative outflow with enough unmatched amount. Previous posted voucher/ledger rows are immutable.

The old `refund_invoice_receipt` endpoint gives an explicit upgrade error because its unkeyed signature cannot safely distinguish a repeated request from a second equal installment. The new UI must use v2 and keep the key on uncertain retries.

## Metadata / follow-up (does not post accounting)

`finance_update_receivable_terms_v1(p_invoice_id text, p_patch jsonb, p_expected_version bigint, p_idempotency_key text, p_data_environment text = 'production') -> jsonb`

Patch allows only `dueDate` (date or null), `ownerId` (active same-tenant Finance user or null), `lastContact` (timestamp or null), `nextActionDate` (date or null), `notes` (up to 2000 characters), `reason` (required nonempty reason, max 500). `p_expected_version` is **metadataVersion**, initially 0, not invoice rowVersion. Unspecified keys remain unchanged. Null dueDate removes the manual override and falls back to source bill/unknown. The caller must be a current accountant/admin_director/CEO and can read the invoice. Successful response `{ok,invoiceId,metadataVersion,idempotent_replay}`. All changes have append-only before/after audit records.

`finance_set_invoice_due_date_v1(p_invoice_id text,p_due_date date,p_expected_version bigint,p_reason text,p_idempotency_key text,p_data_environment text = 'production')` is a convenience wrapper over that metadata RPC.

## Frontend integration points

Load the read RPC using tenant/auth UUID/environment/scope identity keys, discard stale async responses, and show unavailable/retry on failure. Do not label local status-based estimates as official balances. Existing receipt transaction engine may call v2 with additional optional submit options; approval must display the stored amount. Group amounts are sums of individual returned balances, not leader.total times status. Preserve date/company/department/customer/aging filters when drilling down from dashboard. Mutations reload authoritative invoice and canonical read state before showing success; bank receipt amounts and refund amounts must remain distinct.

## Allowance / void compatibility

The existing `post_invoice_lifecycle_voucher` signature remains intact. New monetary lifecycle events split the credit between actual remaining receivables (1123) and refundable collected cash (2131), storing `ar_amount` and `refund_payable_amount`. Existing events keep null allocation columns and their original posted journals. A pending receipt blocks an allowance or void until that review finishes. A new adjustment date cannot precede later linked receivable journals or lifecycle/refund events; this prevents a backdated adjustment from allocating cash that did not exist at that cutoff. Exact existing event-number replay remains idempotent.

New receipts, refunds, lifecycle allocations and private audit data are written only through the authenticated RPC transaction. Private operation rows tied to the current transaction authorize protected lifecycle/ledger writes; a caller-created GUC alone cannot forge that capability. No original journal rows are rewritten.

## Pure frontend totals

`FinanceReceivablesEngine.summarize(items)` sums every canonical row; `summarizeInvoices(invoiceRows, canonicalItems)` joins the exact legacy worklist by `id` / `invoiceId`; `group(items, fieldNameOrFunction)` returns `{key,items,summary}` groups. A missing/duplicated/invalid canonical row yields `ready=false` and null totals, never fabricated zero. Successful results include `count`, `settledCount`, `originalAmount`, `recognizedAmount`, `allowanceAmount`, `arAllowanceAmount`, `receivedAmount`, `pendingReceiptAmount`, `refundPayable`, `refundedAmount`, `outstandingAmount` (positive only), `signedOutstandingAmount`, `creditAmount`, `overdueAmount`, and `unknownDueAmount`. Sum currency in cents. Match the canonical read's company, department and cutoff to the intended legacy worklist before joining.

## Scoped ledger reconciliation and filtered exports (2026-09-11)

Migration: `20260911135457_finance_ar_reconciliation_scope_v1.sql`. The public RPC signatures and invoice read/mutation authority are unchanged. Both the normal AR reader and dashboard reader call the same reconciliation helper.

The new reconciliation fields are `reconciliationVisible`, `reconciliationStatus` (`complete|scope_unverified`), `ledgerNet`, `mappedLedgerNet`, `unmappedLedgerNet`, `unmappedDebitAmount`, `unmappedCreditAmount`, `unmappedEntryCount`, `scopeDifference`, and `needsReview`.

- Complete ledger disclosure requires an existing financial reporting role, the existing `finance_reporting_actor_v1` company/report permission check for every included company (including configured empty companies), `can_read_invoice` for every source invoice in scope, and the existing optional permission helper for the exact ledger company/department dimensions. A selected authorized company can be reconciled even when another company is denied. An all-company request whose full scope cannot be verified cannot disclose aggregate ledger amounts.
- `scope_unverified` retains only the mapped net from already visible invoices. All complete ledger/unmapped amounts and counts, `scopeDifference`, and `needsReview` are null. The UI must say **總帳勾稽待核對**, not zero/no differences. A verified empty company returns complete numeric zeros.
- Nonzero unlinked or ambiguous journal rows retain separate debit and credit residuals. For debit 70 and credit 70, `unmappedLedgerNet=0`, `unmappedDebitAmount=70`, `unmappedCreditAmount=70`, `unmappedEntryCount=2`, and `needsReview=true`. `scopeDifference = ledgerNet - mappedLedgerNet - unmappedLedgerNet` additionally flags mismatched invoice/ledger dimensions. No original invoice or journal is changed.
- Company, department, tenant, environment, cutoff and voided-journal filters apply to all reconciliation amounts. Existing company-only bank reconciliation visibility remains a separate permission/result.

The AR table, its KPI summary and **匯出應收 Excel** use the same customer/invoice/amount query and aging/status filter. Export includes **all matching pages**, not only the 25 currently visible rows. Workbook metadata identifies company, department, cutoff, full query, aging/status and result count; the filename contains the same scope with a shortened query where necessary. An empty filter result exports an explicitly labeled zero-row sheet. Numeric source amounts retain their decimal precision.

Release checks: `scripts/finance_ar_reconciliation_postflight.sql` is read-only and repeatable; `scripts/finance_ar_reconciliation_canary.sql` uses verified authenticated identities with owner-created synthetic test fixtures and rolls back all journals/invoices. Local regressions are `scripts/check_ar_reconciliation_scope.cjs` and `scripts/check_ar_export_reconciliation_ui.cjs`.
