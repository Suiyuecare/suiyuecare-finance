# API Route Design

Base path: `/api/accounting`

All mutation routes must write `audit_logs`.

## Applications

`GET /applications`

Query filters:

- `applicationType`
- `status`
- `applicantId`
- `departmentId`
- `dateFrom`
- `dateTo`
- `amountMin`
- `amountMax`
- `keyword`
- `page`
- `pageSize`

Returns paginated `ApplicationBase[]`.

`POST /applications`

Creates draft application with type-specific detail table rows and attachments metadata.

Validation:

- `amount >= 0`
- required fields by application type
- `advance_request.expectedSettlementDate` required
- `refund_request.refundAmount <= originalPaymentAmount`
- `purchase_request.requiresQuotationComparison = true` when total exceeds threshold
- `hr_expense_request.includeInPayroll` and `isWithholdingRequired` must be explicit booleans

`POST /applications/:id/submit`

Moves `draft` to `submitted`, builds approval steps, sets first review status, writes audit log.

`GET /applications/:id`

Returns `ApplicationDetail`:

- common application data
- type-specific detail
- attachments
- approval steps
- payment records
- accounting entries
- audit logs

`PATCH /applications/:id`

Allowed while status is `draft` or `returned`.

`POST /applications/:id/cancel`

Allowed for applicant before payment.

## Attachments

`POST /applications/:id/attachments`

Accepts multipart upload. Stores files in object storage and creates `attachments` rows.

`DELETE /attachments/:id`

Allowed for draft/returned applications only.

## Approval

`GET /approvals/inbox`

Returns current user's pending approval steps.

`POST /approval-steps/:stepId/approve`

Body:

```json
{ "comment": "Approved" }
```

Marks step approved and advances application status.

`POST /approval-steps/:stepId/return`

Returns application to applicant with comment.

`POST /approval-steps/:stepId/reject`

Rejects application with comment.

## Payment Operations

`GET /payments/pending`

Returns approved or pending-payment applications.

`POST /applications/:id/payment-records`

Body:

```json
{
  "paymentDate": "2026-05-07",
  "paymentAmount": 1000,
  "paymentMethod": "bank_transfer",
  "bankAccount": "808-123456789",
  "transactionReference": "TXN-001",
  "paymentStatus": "paid",
  "note": "Paid by online banking"
}
```

Updates application to `paid` or `payment_failed`.

## Settlement Operations

`GET /settlements/pending`

Returns advance and petty cash applications in:

- `pending_settlement`
- `partially_settled`
- `overdue_settlement`

`POST /applications/:id/settlement-items`

For advance and petty cash settlement details.

`POST /applications/:id/settle`

Calculates:

- actual spending total
- remaining balance
- reimbursement difference
- refund-to-company difference

Updates status to `settled` or `partially_settled`.

## Accounting Entries

`POST /applications/:id/accounting-entries/suggest`

Returns debit/credit suggestions by:

- application type
- category
- invoice type
- payment method
- fixed asset flag
- payroll/withholding flags

`POST /applications/:id/accounting-entries`

Creates manual or suggested voucher entries.

`GET /accounting-entries/export`

Query:

- `accountingMonth`
- `exportStatus`
- `applicationType`

Returns CSV/XLSX-compatible voucher rows.

`POST /accounting-entries/mark-exported`

Marks exported entries as `exported`.

## Suggested Status Transitions

```text
draft -> submitted
submitted -> manager_review
manager_review -> accounting_review
accounting_review -> finance_review
finance_review -> approved
approved -> pending_payment
pending_payment -> paid | payment_failed
paid -> pending_settlement | closed
pending_settlement -> partially_settled | settled | overdue_settlement
settled -> closed
any review status -> returned | rejected
draft/submitted/returned -> cancelled
```

