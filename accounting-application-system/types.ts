export type ApplicationType =
  | 'expense_reimbursement'
  | 'payment_request'
  | 'advance_request'
  | 'petty_cash_request'
  | 'travel_request'
  | 'purchase_request'
  | 'refund_request'
  | 'hr_expense_request';

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'manager_review'
  | 'accounting_review'
  | 'finance_review'
  | 'approved'
  | 'pending_payment'
  | 'paid'
  | 'pending_settlement'
  | 'partially_settled'
  | 'settled'
  | 'closed'
  | 'returned'
  | 'rejected'
  | 'cancelled'
  | 'payment_failed'
  | 'overdue_settlement';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'returned';

export interface ApplicationBase {
  id: string;
  applicationNo: string;
  applicationType: ApplicationType;
  applicantId: string;
  departmentId: string;
  amount: number;
  currency: 'TWD' | string;
  paymentMethod?: string;
  payeeType?: string;
  payeeName?: string;
  accountingMonth?: string;
  projectId?: string;
  locationId?: string;
  description?: string;
  accountingSubjectSuggestion?: string;
  status: ApplicationStatus;
  createdAt: string;
  submittedAt?: string;
  approvedAt?: string;
  paidAt?: string;
  closedAt?: string;
}

export interface ApprovalStep {
  id: string;
  applicationId: string;
  stepOrder: number;
  approverRole: string;
  approverId?: string;
  status: ApprovalStatus;
  comment?: string;
  approvedAt?: string;
}

export interface Attachment {
  id: string;
  applicationId: string;
  fileName: string;
  fileUrl: string;
  fileType?: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface PaymentRecord {
  id: string;
  applicationId: string;
  paymentDate: string;
  paymentAmount: number;
  paymentMethod: string;
  bankAccount?: string;
  transactionReference?: string;
  paymentStatus: string;
  paidBy: string;
  note?: string;
}

export interface AccountingEntry {
  id: string;
  applicationId: string;
  debitAccount: string;
  creditAccount: string;
  amount: number;
  description?: string;
  accountingMonth: string;
  exportStatus: 'not_exported' | 'exported' | 'failed';
  createdAt: string;
}

export interface AuditLog {
  id: string;
  applicationId?: string;
  actorId?: string;
  action: string;
  beforeData?: Record<string, unknown>;
  afterData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  createdAt: string;
}

export interface AdvanceItem {
  itemName: string;
  estimatedAmount: number;
  purpose?: string;
  expectedPayee?: string;
}

export interface PettyCashExpenseItem {
  expenseDate: string;
  category: string;
  amount: number;
  receiptNumber?: string;
  description?: string;
  attachmentId?: string;
}

export interface PurchaseItem {
  itemName: string;
  specification?: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  purpose?: string;
  usageLocationId?: string;
}

export type ApplicationSpecificPayload =
  | {
      applicationType: 'expense_reimbursement';
      expenseDate: string;
      expenseCategory: string;
      paymentMethod: string;
      employeeBankAccountId?: string;
      invoiceType?: string;
      invoiceNumber?: string;
      taxId?: string;
      projectId?: string;
      locationId?: string;
    }
  | {
      applicationType: 'payment_request';
      payeeType: string;
      payeeName: string;
      payeeTaxId?: string;
      payeeBankName?: string;
      payeeBankBranch?: string;
      payeeBankAccount?: string;
      payeeBankAccountName?: string;
      paymentCategory: string;
      dueDate: string;
      isWithholdingRequired: boolean;
      contractId?: string;
      purchaseOrderId?: string;
    }
  | {
      applicationType: 'advance_request';
      advancePurpose: string;
      expectedUsageDate: string;
      expectedSettlementDate: string;
      employeeBankAccountId?: string;
      projectId?: string;
      eventId?: string;
      reason: string;
      advanceItems: AdvanceItem[];
    }
  | {
      applicationType: 'petty_cash_request';
      pettyCashLocationId: string;
      requestType: 'new' | 'replenish' | 'close' | 'adjust_limit';
      requestedAmount: number;
      approvedLimit?: number;
      currentBalance: number;
      custodianId: string;
      custodyLocation?: string;
      usageScope?: string;
      periodStart?: string;
      periodEnd?: string;
      pettyCashExpenseItems?: PettyCashExpenseItem[];
    }
  | {
      applicationType: 'travel_request';
      travelType: 'domestic' | 'international' | 'cross_county' | 'same_day';
      purpose: string;
      destination: string;
      startDatetime: string;
      endDatetime: string;
      transportationMethod?: string;
      requiresAccommodation: boolean;
      requiresAdvance: boolean;
      estimatedTransportationFee: number;
      estimatedLodgingFee: number;
      estimatedMealFee: number;
      estimatedMiscFee: number;
      projectId?: string;
      substituteEmployeeId?: string;
    }
  | {
      applicationType: 'purchase_request';
      purchaseType: string;
      reason: string;
      isFixedAsset: boolean;
      isUrgent: boolean;
      requiredDate?: string;
      budgetSource?: string;
      suggestedVendorId?: string;
      requiresQuotationComparison: boolean;
      purchaseItems: PurchaseItem[];
    }
  | {
      applicationType: 'refund_request';
      refundeeType: string;
      refundeeName: string;
      refundeeContact?: string;
      originalPaymentDate: string;
      originalPaymentAmount: number;
      refundAmount: number;
      refundReason: string;
      refundMethod: string;
      refundBankName?: string;
      refundBankBranch?: string;
      refundBankAccount?: string;
      refundBankAccountName?: string;
      requiresAllowanceNote: boolean;
      relatedIncomeRecordId?: string;
    }
  | {
      applicationType: 'hr_expense_request';
      payeeType: 'employee' | 'part_time' | 'external_lecturer' | 'consultant' | 'care_worker';
      payeeId?: string;
      payeeName: string;
      expenseType: string;
      payrollMonth?: string;
      calculationStartDate?: string;
      calculationEndDate?: string;
      calculationDescription?: string;
      includeInPayroll: boolean;
      isWithholdingRequired: boolean;
      requiresLaborInsuranceAction: boolean;
      expectedPaymentDate?: string;
    };

export type CreateApplicationPayload = {
  applicantId: string;
  departmentId: string;
  amount: number;
  currency?: string;
  paymentMethod?: string;
  payeeType?: string;
  payeeName?: string;
  accountingMonth?: string;
  projectId?: string;
  locationId?: string;
  description?: string;
  attachments?: File[];
} & ApplicationSpecificPayload;

export interface ApplicationDetail extends ApplicationBase {
  detail: ApplicationSpecificPayload;
  approvalSteps: ApprovalStep[];
  attachments: Attachment[];
  paymentRecords: PaymentRecord[];
  accountingEntries: AccountingEntry[];
  auditLogs: AuditLog[];
}
