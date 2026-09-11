# Finance reporting profiles and VAT workpapers v1

This is a review workpaper contract, not an electronic VAT filing format. No API in this feature posts journals, edits source requests/invoices, submits tax returns or certifies financial statements. All unknown classifications remain null / 待設定.

## Persistence API

- `finance_reporting_profile_read_v1(p_entity_id text, p_data_environment text default 'production')` returns `{ok,entityId,dataEnvironment,revision,profile,updatedAt,canEdit,canEditWorkpaper}`. No saved row returns revision 0 and an empty v1 profile. `all` is not a legal entity argument.
- `finance_reporting_profile_save_v1(p_entity_id text,p_expected_revision bigint,p_profile jsonb,p_reason text,p_data_environment text default 'production')` returns the same shape. Nonempty reason, exact expected revision, authenticated verified Finance identity, and existing authorized reporting/settings scope are required. Every successful save appends a full immutable revision. A conflict is SQLSTATE 40001; nothing is saved.
- `finance_reporting_profile_history_v1(p_entity_id text,p_data_environment text default 'production')` returns up to 50 newest `{revision,reason,createdAt,actorId,profile}` records under the same scope.
- Tables `public.finance_reporting_profiles` and `private.finance_reporting_profile_revisions_v1` have RLS and no direct anon/authenticated/service_role grants. Only scoped RPCs expose data. Profiles cannot reference a nonexistent or cross-tenant/company document. Source business records remain unchanged.

Read access follows the existing dashboard roles (`accountant`, `ceo`, `admin_director`, `external_audit`, `board`) and saved `role_permissions.reports`; existing optional `finance.request.view.all` control-plane checks are honored when installed. No new permission code is guessed. Settings writes require current `is_finance_admin()` and saved `settings` edit/delete. `canEditWorkpaper` additionally allows an accountant with saved reports edit/delete to change **only** `documents` and `tax.periods`, enforced by an exact server-side path diff. All other fields must round-trip unchanged. The authenticated RPC identity uses the existing verified Google/current Finance-user resolver, not a client actor ID. Scope revocation also blocks historical profile disclosure.

## Profile object

Top-level known keys only:

```json
{
  "schemaVersion": 1,
  "accountingFramework": null,
  "tax": {},
  "accountMappings": {},
  "costCenters": [],
  "budgets": [],
  "allocations": [],
  "eliminations": [],
  "periodChecks": {},
  "documents": {}
}
```

- `accountingFramework`: null, `eas`, or `ifrs`; never inferred from company name.
- `tax`: `{formType:null|'401'|'403',taxId:null|string,legalName:null|string,taxRegistrationNo:null|string,responsiblePerson:null|string,address:null|string,filingFrequency:null|'bimonthly'|'monthly',monthlyApprovalReference:null|string,filingMode:null|'individual'|'head_office_aggregate',deductionMethod:null|'proportional'|'direct',directMethodSince:null|'YYYY-MM-DD',periods:{}}`.
- `tax.periods` keyed `YYYY-MM-DD/YYYY-MM-DD`: each `{priorCarryforwardTax:null|number,foreignServicePayableTax:null|number,specialTaxPayableTax:null|number,annualAdjustmentPayableTax:null|number,annualAdjustmentRefundTax:null|number,refundLimitConfirmedTax:null|number,yearEndAdjustmentRequired:null|boolean,annualAdjustmentReviewed:null|boolean,nonDeductibleRatio:null|number,ratioExclusionsReviewed:null|boolean,annualTotals:null|object}`. Ratios are fractions 0–1; unknown is null. Year-end adjustments cannot be silently assumed zero. `annualTotals` supports `inputTax,article19ExcludedTax,exemptOnlyInputTax,commonInputTax,deductedInputTax,nonDeductibleRatio` for auditable annual adjustment estimates. Unsupported foreign/special/land/securities adjustments remain explicitly review-required.
- `accountMappings`: map code → `{statementClass:null|'asset'|'liability'|'equity'|'revenue'|'cost'|'expense'|'otherIncome'|'otherExpense'|'incomeTax',cashFlowClass:null|'operating'|'investing'|'financing'|'noncash'|'unclassified',ociCategory:null|'reclassifiable'|'nonreclassifiable',normalSide:null|'debit'|'credit'}`. Account code must exist in the tenant catalog. OCI is explicit, not every 3xxx account.
- `costCenters`: `[{departmentCode,kind:'profit'|'cost'|'shared',name}]`; department must belong to this company under the formal organization entity scope. This classifies presentation and does not rewrite posted dimensions.
- `budgets`: `[{id,period:'YYYY-MM',departmentCode,accountCode,amount,status:'draft'|'reviewed',effectiveFrom:'YYYY-MM-DD',effectiveTo:null|'YYYY-MM-DD',reviewReason}]`. All amounts nonnegative, duplicate IDs forbidden. Review metadata is server-owned.
- `allocations`: `[{id,name,sourceDepartmentCode,accountCodes:[],basis:'fixed_percentage'|'headcount'|'area'|'revenue'|'manual',targets:[{departmentCode,weight}],status:'draft'|'reviewed',effectiveFrom,effectiveTo,reviewReason}]`. Positive weights must total 1 for a reviewed rule. Basis and weights are explicit, never synthesized from unknown headcounts. Source and target scopes must be in the same company. These are management workpaper adjustments only. No SQL journal posting occurs.
- `eliminations`: `[{id,name,counterpartyEntityId,period:'YYYY-MM',lines:[{entityId,departmentCode,accountCode,debit,credit,sourceRef}],status:'draft'|'reviewed',effectiveFrom,effectiveTo,reviewReason}]`. Requires access to both entities; line entity must be this company or counterparty, all accounts/departments valid. Reviewed lines must be balanced across the pair and have source references. These are separate consolidation workpapers, never modifications to either legal entity's ledger.
- Reviewed allocation/budget/elimination rows receive server-owned `reviewedBy`, `reviewedAt`, `reviewedRevision`. Clients may round-trip them, but cannot invent them. Changing reviewed rule business values returns it to draft; resubmission for review with a reason is a new review. The review is an explicit management attestation; free-text `sourceRef` is retained for reconciliation and is not proof that a database journal has been verified. Same actor may review if already allowed to manage these settings; this does not represent a CEO workflow or second-person approval.
- `periodChecks`: map `YYYY-MM` → `{ociReviewed,periodCloseReady,openingBalanceVerified,bankReconciled,taxReconciled}` booleans/null, explicitly asserted by the authorized reviewer and versioned; these are review attestations, never replacements for factual server checks.

## Persistent source-document classifications

`profile.documents` map any stable UI key → object:

`{sourceType:'invoice'|'expense_request',sourceId,sourceLineId:null|string,formatCode:null|string,taxClass:null|'taxable'|'zero_rated'|'exempt'|'out_of_scope'|'special',deduction:null|'eligible'|'article19_excluded'|'not_claimed_policy',usage:null|'taxable_only'|'exempt_only'|'common',assetKind:null|'expense'|'fixed_asset',number:null|string,date:null|'YYYY-MM-DD',originalNetAmount:null|number,originalTaxAmount:null|number,grossAmount:null|number,sellerTaxId:null|string,buyerTaxId:null|string,zeroRateExport:null|'customs'|'non_customs',isReturn:boolean,originalDocumentId:null|string,evidenceReference:null|string,classificationReason:string}`.

The RPC validates `sourceId` against the actual source table, tenant, environment and company; it does not accept a client-provided entity scope. `sourceLineId` is a stable UI receipt/line identifier, not a claim to another database record. A changed classification requires a reason. Stored original amounts mean accountant-entered transcription of the original certificate and are audited; they never overwrite source or posted amounts. Missing original amounts must not become zero.

Utility gross-expense accounting remains unchanged: book tax 0 does not mean the original utility invoice is exempt. Workpaper `originalTaxAmount` and explicit deduction classification are separate from `bookTaxAmount`. A utility tax deduction that disagrees with book treatment is flagged for reconciliation, not automatically posted or silently deducted.

## Tax engine and workbook adapter

`window.FinanceTaxReportEngine` (also CommonJS) exposes `validateProfile`, `buildWorkpaper`, `workbookSheets`, `officialSources`, `fieldDefinitions`.

`buildWorkpaper({profile,entityId,period:{start,end},sales:[],purchases:[],adjustments:{},completeness:{sales:boolean,purchases:boolean}})`.

Each document: `{id,entityId,date,number,formatCode,taxClass,netAmount,originalTaxAmount,grossAmount,bookTaxAmount,description,deduction,usage,assetKind,sellerTaxId,buyerTaxId,zeroRateExport,isReturn,originalDocumentId,evidenceReference}`. Dates are certificate/reporting dates, not automatically cash or final-ledger dates. Parent adapter combines original evidence with saved classifications; original values and book values remain separate.

Output: `{status:'needs_configuration'|'needs_review'|'ready_for_review',filingReady:false,form:null|'401'|'403',entityId,period,fields:[{code,label,value,knownSubtotal,status,sourceIds}],documents,checks,summary,officialSources}`. Any missing classification, certificate data, unsupported special category or incomplete source list blocks ready-for-review; no state means legally filed/accepted.

`workbookSheets(workpaper)` gives `[{name,rows}]` for XLSX: `工作底稿說明` (version/source/company/period/status), `401欄位核對` or `403欄位核對` (official field code/name/value/status/source IDs), `銷項憑證`, `進項扣抵明細`, `調整與勾稽` (severity/code/reason/source). These are clearly named workpaper sheets, not BAN.TXT/BAN.TET_U filing files.

Official field codes from the unchanged MOF A4 form: sales 1–24, total 25, land 26/other fixed assets 27; input 28–49 and customs 78–81; 403 ratio 50/deductible tax 51; VAT settlement 101,103–115; exempt imports 73/foreign services 74–76. Values unsupported by this bounded engine remain null/待人工核對, not invented zero. Direct-deduction 403 needs the separate allocation appendix; annual adjustments need year totals and accountant review.

## Official sources retained

- MOF form/detail: https://www.etax.nat.gov.tw/etwmain/etw212w/detail/189b50a490600000c0cddfef1a752804 (published form update 2023-08-31; accessed 2026-09-10).
- Unmodified source PDF: `docs/reference/taiwan-vat-401-403-404-official-20230831.pdf`; SHA256 `f78296b7c16911d739a3d8042b5793fa4dfd9892105c7de8730190ea17ad5dd7`. Pages 1/2 are 401/form notes, pages 3/4 403/form notes. Page 5 is 404, not implemented.
- Mixed-tax calculation rules: https://law-out.mof.gov.tw/LawContent.aspx?id=FL006087 (accessed 2026-09-10).
- MOF electronic filing FAQ: https://www.tax.nat.gov.tw/alltax-faq.html?id=2 (accessed 2026-09-10).
- Utility certificate format distinction: https://tax.nat.gov.tw/db/news_BLR/news_7.html . Modern utility electronic certificates use format 25; use must be confirmed from the actual certificate.

The official PDF is preserved unchanged; generated sheets do not imitate a stamped official return or receipts of successful filing.

## Verification and bounded coverage

- `node scripts/check_tax_report_engine.js`: official field calculations and missing-data/reconciliation checks.
- `node scripts/check_finance_reporting_profiles.js`: actual new migration/RPCs in PGlite with anonymous fixture identity sources, CAS/rollback, scopes, RLS/ACL and narrow accountant path authorization. Existing verified identity functions are dependencies, not changed.
- `scripts/finance_reporting_profiles_postflight.sql`: repeatable read-only catalog and current/audit consistency checks.
- Ordinary sales/purchase returns use their explicit return format codes. Customs excess-tax refunds (29), special tax, land/securities exclusions, foreign service supplemental forms and head-office aggregation remain explicitly manual review; they cannot claim ready-for-review from this bounded engine.
- Review-ready workpapers always have `filingReady:false`. Period/group input-tax rounding differences are retained as an explicit reconciliation amount. Official form source remains unchanged.

Explicit `out_of_scope` classifications require a recorded `classificationReason`, stable source/date and evidence. They preserve unknown original tax as null, require no invented VAT invoice/seller identifier, and are excluded from official VAT sums. Unclassified payroll/funding is never automatically treated as out of scope.

## Comparative statements, cash-event reconciliation and monthly policy

The current and comparison periods each retain their own accounting warnings and review attestations. Comparison warnings carry `comparison:true`, `period`, a `comparison_` code prefix and a visible period label. They participate in `readyForReview` and the exported review worksheet; a clean current period cannot certify a problematic comparison. Export introductions name both the legal-entity scope and the department code (or `全部部門`). Department analysis is explicitly labelled as not a full legal-entity statement.

Cash balances and cash-flow activities continue to come exclusively from posted ledger entries. An expected request cash event is not an additional journal. `current.cf.cashEventReconciliation` contains events with `status:'matched'|'unmatched'`, a reason for unresolved events, and matched ledger IDs when available. The legacy `unpostedCashEvents`/`unpostedCashAmount` fields now mean **cash events awaiting reconciliation**, not a definitive claim that no journal exists. The amount is the signed expected event amount, never a second deduction from book cash. Invalid amounts remain null and explicitly flagged. Current and comparative unresolved events appear in the cash-flow worksheet with their period, date, identity, source, expected amount and reason.

The runtime supplies stable `eventId`, `eid`, `sourceId`, `date`, signed `amount`, `sourceTypes`, and the recorded `voucherNo` where available. Advance disbursement and settlement have separate event identities and source types; corrections retain correction and bank-transaction identities. Matching requires the same company, event date and explicit source/voucher constraints. Multiple cash lines can satisfy one event, or multiple distinct events can share a combined transaction, only when positive inflows and negative outflows each agree to the cent. A cash line cannot satisfy overlapping event groups. Missing identity, conflicting duplicate identities, ambiguous vouchers, missing explicit posting keys, dates or amounts remain unresolved. Exact duplicate event IDs are not counted twice. Same request number or original advance posting alone does not prove a later settlement. Date differences remain for human reconciliation; this feature neither backdates events nor rewrites formal entries.

Reviewed **monthly budgets and eliminations** apply their full approved month amount only when `effectiveFrom` is no later than the first day and `effectiveTo` is absent or no earlier than the last day of their `period`. A selected month's reviewed rule that fails this check is not applied and emits `partial_month_rule`, with company, rule ID, kind and month: `未套用，需調整生效期間／另建核定月額`. There is no automatic daily proration. A quarterly report checks each underlying month, including leap-year month ends. Existing saved review metadata and prior revisions are never changed by report generation. Transaction-based allocations continue to use each actual ledger entry's date.

Regression coverage: `check_financial_statements.cjs` exercises the real model and workbook adapter; `check_financial_statement_runtime.cjs` executes the real index closure functions with anonymous local fixtures; `check_management_report_engine.cjs` verifies full-month coverage, leap days, quarter gaps, cross-company warnings and unchanged daily allocations. These local checks do not establish live account acceptance or publication.
