# Financial statement model

`window.FinanceFinancialStatements` is a pure calculation engine. The application exposes `statementReportModel(entityId, period, options)` and `statementDataCompleteness()` inside its runtime. Callers must use the same model for screen and export; do not re-sum display rows independently.

Inputs: `{ledger, entityId, period, comparisonPeriod?, departmentCode?, accountMappings?, accountMappingsByEntity?, completeness?, checks?, previousChecks?, cashEvents?, cashFlowOverrides?}`. `ledger` accepts mapped UI rows and database column names. Entity, department and data environment/tenant filtering are enforced by the application adapter; the pure engine additionally filters entity/department and excludes voided rows. Invalid dates/amounts remain visible as validation issues rather than silently establishing completeness.

Profile accessor: `window.FinanceReportingWorkspace.profileFor(entityId)` may return either the profile or its `{profile,revision,...}` RPC envelope. Explicit `options` override the profile. `periodChecks[period]` provides the reviewed preparation flags; flags do not create ledger balances or closing journals.

Account mappings: keyed by exact account code, `{statementClass, cashFlowClass, ociCategory, normalSide}`. `statementClass` is `asset|liability|equity|revenue|cost|expense|otherIncome|otherExpense|incomeTax`. `cashFlowClass` is `operating|investing|financing|noncash|unclassified`. `ociCategory` is `reclassifiable|nonreclassifiable|null`; no account is silently made OCI by its number. `normalSide` is `debit|credit`. Default account classes follow the existing 1/2/3/4/5/6/7/9 catalog. Cash classes use counterpart accounts and explicit transaction types, never description keywords. Ambiguous cash movements appear in `unclassified`.

For aggregate models, pass `accountMappingsByEntity: {entityId: {accountCode: mapping}}`. It takes precedence over global `accountMappings`; missing entity entries use default classes, never another entity's configuration. The application collects these from each `ENTS` entity profile for `all`. `normalSide` is preserved profile metadata; balances remain signed by statement class and actual debit/credit, so contra-accounts and OCI tax effects are not inverted into false gains.

Output `buildModel(input)`:

```text
{
  entityId, departmentCode, period, previousPeriod,
  status: 'draft', readyForReview, warnings: [{code,message,...}], completeness,
  current, previous, comparison: previous,
  changes: {revenue, expense, netProfit, comprehensiveIncome, cashEnd},
  scope: 'entity' | 'aggregate' // aggregate is not a consolidated statement
}

current/previous = {
  period, bounds:{start,end}, rowCount,
  bs: {
    assets, liabs, equity, assetTotal, liabTotal, equityTotal,
    unclosedProfit, unclosedOci, dynamicProfit, balanceDifference, source
  },
  pl: {
    revenueRows, costRows, expenseRows, otherIncomeRows, otherExpenseRows, incomeTaxRows,
    revenue, cost, grossProfit, operatingExpense, operatingProfit,
    otherIncome, otherExpense, profitBeforeTax, incomeTax, netProfit,
    totalRevenue, totalExpense,
    ociRows, ociReclassifiable, ociNonreclassifiable, ociTotal,
    comprehensiveIncome, ociConfigured, ociReviewed
  },
  cf: {
    start, opIn, opOut, op, inv, fin, unclassified, net, end, bookEnd,
    reconciliationDifference, activities, internalTransfers, unpostedCashEvents, unpostedCashAmount, source
  },
  trialBalance: {periodDebit,periodCredit,periodDifference,cumulativeDebit,cumulativeCredit,
    cumulativeDifference,balanceDifference,cashDifference,checks,ok},
  departments: [{eid,dc,name,income,expense,net,...}],
  warnings
}
```

Account rows preserve compatibility fields `{key,n,v,dc}` plus descriptive account fields. Delta objects contain `{current,previous,amount,percent}`; percent is null when the comparison denominator is zero. Previous defaults to the preceding month, quarter or year; `all` has no implicit comparison.

BS includes all remaining P&L account balances through the cutoff as a separate **unclosed profit estimate**, even if some accounts have already been closed. Closing journals are not fabricated. P&L excludes explicitly identified closing journals; cumulative BS retains them. Net profit and OCI remain separate; OCI review/configuration gaps are explicit.

Cash flow starts and ends with actual cash ledger balances. A balanced transaction's noncash counterpart determines its cash class. Cash-to-cash transfers are excluded from activity receipts/payments. Mixed opposing classes (for example, an asset partly financed without cash), unbalanced or untraceable transactions are unclassified pending review; their actual cash change still reconciles. `cashFlowOverrides` uses `entityId|referenceNo` keys for explicit source transaction classification. Unposted request cash events are shown separately and do not become a fabricated ledger balance.

`exportSheets(model)` / application `statementExportSheets(entityId,period,options)` returns `[{name,rows}]`, where rows are arrays suitable for CSV/XLSX/PDF adapters. Every sheet is marked draft and includes scope, period/comparison and completeness notes. It includes BS, comprehensive income, cash flow (including opening/closing), trial balance, department profit and review notes.

`loadLedgerPages(fetchPage, options)` reads sequential pages with exact count, unique stable row IDs and stable total checks. It rejects partial/duplicate/changing results and never reports a failed partial read as complete. The adapter keeps prior data on failure but marks it stale/incomplete. This API does not impersonate users or change RLS/authorization.

The same loader covers `ledger_entries`, `invoices` and `expense_requests`. `statementDataCompleteness()` returns `{complete,status,rowCount,tables:{ledger,invoices,expense_requests},promise}`. Each table has `{complete,status,rowCount,total,pages,loadedAt,error}`. The statement model consumes `tables.ledger`; tax workpapers must require all three `complete` flags. Identity is bound to the current user, tenant and data environment. Count and duplicate checks protect paginated reads, but do not claim a database transaction snapshot across concurrent writes.

Behavior regressions: `node scripts/check_financial_statements.cjs` (31 checks) and `node scripts/check_financial_statement_runtime.cjs` (14 checks). They exercise the real engine and extracted application functions, including 6,501 ledger rows, failure/identity invalidation, signed department totals, per-entity mappings, and export source parity.
