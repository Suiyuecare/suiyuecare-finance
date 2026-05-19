# Enterprise Accounting Application System

This folder contains a ready-to-adapt architecture package for an internal accounting application workflow.

## Files

- `schema.sql`: PostgreSQL / Supabase schema.
- `types.ts`: TypeScript domain types and request payloads.
- `api-routes.md`: API route design and state transitions.
- `AccountingApplicationApp.tsx`: React UI scaffold with list, create, detail, review, payment and settlement pages.

## Application Types

1. `expense_reimbursement`: 費用報銷
2. `payment_request`: 付款申請
3. `advance_request`: 預支申請
4. `petty_cash_request`: 零用金申請
5. `travel_request`: 差旅申請
6. `purchase_request`: 採購申請
7. `refund_request`: 退費申請
8. `hr_expense_request`: 人事費用申請

## Validation Rules

- Required common fields: applicant, department, amount, description.
- Amount fields must be zero or positive.
- Advance request requires expected settlement date.
- Refund amount cannot exceed original payment amount.
- Purchase request over threshold sets `requires_quotation_comparison = true`.
- HR expense request must explicitly mark payroll inclusion and withholding.
- Every create/update/approval/payment/settlement action should write `audit_logs`.

## Suggested Implementation Steps

1. Run `schema.sql` in Supabase SQL editor or through migration tooling.
2. Copy `types.ts` into your frontend/shared package.
3. Implement the API routes from `api-routes.md`.
4. Mount `AccountingApplicationApp.tsx` in your React/Next project.
5. Replace placeholder data with API calls.
6. Connect file upload to Supabase Storage or your internal object storage.
7. Add role-based access control to approval, payment, HR and accounting actions.
