# Dashboard revenue and department overview remediation

The executive overview can understate recognized income when a fully approved invoice has a receipt but no revenue posting. A home-care recognition rule was limited to one department; the second home-care department had no matching rule. Separately, the overview displayed only each company's three lowest-profit departments, hiding income-bearing departments while including them in the company total.

The overview now displays Income, Expense, Net Profit, Receivables and Net Cash Flow in that order. All departments are visible by default. Company subtotals show income, expense and net profit; explicit collapsed views show how many departments are visible. Data read failures and authorization revocation retain their existing distinct behavior.

The scoped database repair adds one company/department/item-specific rule and retries only two reviewed, fully approved sources through the existing revenue writer. The source amount, date, accounting selection, approval state, exact existing receipt rows and open accounting period must still match. The original receipt rows remain unchanged. Any mismatch rolls back both sources and the rule; repeated execution must be idempotent. No pending workflow is approved by this repair.

The dashboard reconciliation now checks for income-account entries instead of treating any receipt entry as evidence of revenue recognition. Confirmed completed-but-unposted income produces a visible warning while the reported figures continue to use the formal ledger. The V2 body change preserves its HR, tenant, role and row-scope guards and leaves V3 financial calculations unchanged.

## Validation

- `pnpm test:dashboard-readiness`: complete company/department overview and existing source readiness.
- `node scripts/check_financial_statement_runtime.cjs`: five metric order, expense direction, missing-income notice without fabricated revenue, and incomplete-data states.
- `node scripts/check_dashboard_readiness_browser.cjs`: desktop/mobile rendering, independent company totals, complete department visibility, loading/error and authorization-revocation states.
- `pnpm test:revenue-repair-release`: actual revenue writer, exact-source rollback/idempotency, real dashboard gap detection and protected release transaction tests.

The database migration is a reviewed repair candidate, not evidence of production application. See the production release procedure for the required predecessor chain, atomic rehearsal, read-only canaries and exact target commit. UI-only publication does not repair historical revenue.
