import React, { useMemo, useState } from 'react';
import type { ApplicationStatus, ApplicationType, CreateApplicationPayload } from './types';

type Page = 'list' | 'new' | 'detail' | 'review' | 'payment' | 'settlement';

const APPLICATION_TYPES: Array<{ value: ApplicationType; label: string; hint: string }> = [
  { value: 'expense_reimbursement', label: '費用報銷', hint: '員工已代墊費用，向公司申請報銷' },
  { value: 'payment_request', label: '付款申請', hint: '公司直接付款給廠商或合作對象' },
  { value: 'advance_request', label: '預支申請', hint: '員工先預支款項，之後核銷' },
  { value: 'petty_cash_request', label: '零用金申請', hint: '部門或據點小額零用金' },
  { value: 'travel_request', label: '差旅申請', hint: '因公出差前核准，可連動預支與報銷' },
  { value: 'welfare_request', label: '福利申請', hint: '福利、津貼、補助或非薪資性給付' },
  { value: 'purchase_request', label: '採購申請', hint: '購買物品、設備、服務、軟體或工程' },
  { value: 'refund_request', label: '退費申請', hint: '退還已收款項給客戶、學員或案家' },
  { value: 'hr_expense_request', label: '人事費用申請', hint: '薪資、獎金、講師費、兼職費等' },
];

const STATUSES: ApplicationStatus[] = [
  'draft',
  'submitted',
  'manager_review',
  'accounting_review',
  'finance_review',
  'approved',
  'pending_payment',
  'paid',
  'pending_settlement',
  'partially_settled',
  'settled',
  'closed',
  'returned',
  'rejected',
  'cancelled',
  'payment_failed',
  'overdue_settlement',
];

const PURCHASE_QUOTATION_THRESHOLD = 30000;

const initialForm: Partial<CreateApplicationPayload> = {
  applicationType: 'expense_reimbursement',
  applicantId: '',
  departmentId: '',
  amount: 0,
  currency: 'TWD',
  description: '',
};

export default function AccountingApplicationApp() {
  const [page, setPage] = useState<Page>('list');
  const [selectedType, setSelectedType] = useState<ApplicationType>('expense_reimbursement');
  const [form, setForm] = useState<Partial<CreateApplicationPayload>>(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const amount = Number(form.amount || 0);
  const requiresQuotation = useMemo(() => {
    if (selectedType !== 'purchase_request') return false;
    return amount >= PURCHASE_QUOTATION_THRESHOLD;
  }, [amount, selectedType]);

  function update(key: string, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function changeType(type: ApplicationType) {
    setSelectedType(type);
    setForm({ ...initialForm, applicationType: type });
    setErrors({});
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!form.applicantId) next.applicantId = '必填';
    if (!form.departmentId) next.departmentId = '必填';
    if (amount < 0) next.amount = '金額不可為負數';
    if (!amount) next.amount = '金額必填且需大於 0';
    if (!form.description) next.description = '請填寫申請說明';

    if (selectedType === 'advance_request' && !field('expectedSettlementDate')) {
      next.expectedSettlementDate = '預支申請必須填寫預計核銷日期';
    }
    if (selectedType === 'refund_request') {
      const original = Number(field('originalPaymentAmount') || 0);
      const refund = Number(field('refundAmount') || 0);
      if (refund > original) next.refundAmount = '退費金額不可大於原收款金額';
    }
    if (selectedType === 'hr_expense_request') {
      if (typeof field('includeInPayroll') !== 'boolean') next.includeInPayroll = '請選擇是否併入薪資';
      if (typeof field('isWithholdingRequired') !== 'boolean') next.isWithholdingRequired = '請選擇是否扣繳';
    }
    if (selectedType === 'purchase_request' && requiresQuotation) {
      update('requiresQuotationComparison', true);
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function submit() {
    if (!validate()) return;
    console.log('submit payload', {
      ...form,
      applicationType: selectedType,
      requiresQuotationComparison:
        selectedType === 'purchase_request' ? Boolean(field('requiresQuotationComparison') || requiresQuotation) : undefined,
    });
    alert('表單驗證通過。請接 POST /api/accounting/applications');
  }

  function field(key: string) {
    return (form as Record<string, unknown>)[key];
  }

  return (
    <div className="acct-app">
      <style>{styles}</style>
      <aside>
        <div className="brand">會計申請系統</div>
        <button onClick={() => setPage('list')}>申請單列表</button>
        <button onClick={() => setPage('new')}>新增申請</button>
        <button onClick={() => setPage('detail')}>申請單詳情</button>
        <button onClick={() => setPage('review')}>審核頁</button>
        <button onClick={() => setPage('payment')}>付款作業</button>
        <button onClick={() => setPage('settlement')}>核銷作業</button>
      </aside>
      <main>
        {page === 'list' && <ApplicationListPage />}
        {page === 'new' && (
          <NewApplicationPage
            selectedType={selectedType}
            form={form}
            errors={errors}
            amount={amount}
            requiresQuotation={requiresQuotation}
            onTypeChange={changeType}
            onChange={update}
            onSubmit={submit}
          />
        )}
        {page === 'detail' && <DetailPage />}
        {page === 'review' && <ReviewPage />}
        {page === 'payment' && <PaymentPage />}
        {page === 'settlement' && <SettlementPage />}
      </main>
    </div>
  );
}

function ApplicationListPage() {
  return (
    <section>
      <Header title="申請單列表" subtitle="依申請類型、狀態、申請人、部門、日期、金額查詢" />
      <div className="filters">
        <select><option>全部類型</option>{APPLICATION_TYPES.map((t) => <option key={t.value}>{t.label}</option>)}</select>
        <select><option>全部狀態</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        <input placeholder="申請人" />
        <input placeholder="部門" />
        <input type="date" />
        <input type="number" min={0} placeholder="最低金額" />
        <input type="number" min={0} placeholder="最高金額" />
      </div>
      <div className="table">
        <div className="tr th"><span>單號</span><span>類型</span><span>申請人</span><span>部門</span><span>金額</span><span>狀態</span></div>
        <div className="empty">尚無資料。串接 GET /api/accounting/applications 後顯示列表。</div>
      </div>
    </section>
  );
}

function NewApplicationPage(props: {
  selectedType: ApplicationType;
  form: Partial<CreateApplicationPayload>;
  errors: Record<string, string>;
  amount: number;
  requiresQuotation: boolean;
  onTypeChange: (type: ApplicationType) => void;
  onChange: (key: string, value: unknown) => void;
  onSubmit: () => void;
}) {
  return (
    <section>
      <Header title="新增申請" subtitle="先選擇申請類型，再填寫對應欄位" />
      <div className="type-grid">
        {APPLICATION_TYPES.map((type) => (
          <button
            key={type.value}
            className={props.selectedType === type.value ? 'type active' : 'type'}
            onClick={() => props.onTypeChange(type.value)}
          >
            <b>{type.label}</b>
            <small>{type.hint}</small>
          </button>
        ))}
      </div>
      <div className="panel">
        <h3>共同欄位</h3>
        <div className="form-grid">
          <Field label="申請人 ID" error={props.errors.applicantId}><input onChange={(e) => props.onChange('applicantId', e.target.value)} /></Field>
          <Field label="部門 ID" error={props.errors.departmentId}><input onChange={(e) => props.onChange('departmentId', e.target.value)} /></Field>
          <Field label="金額" error={props.errors.amount}><input type="number" min={0} onChange={(e) => props.onChange('amount', Number(e.target.value))} /></Field>
          <Field label="付款方式"><input onChange={(e) => props.onChange('paymentMethod', e.target.value)} /></Field>
          <Field label="專案 ID"><input onChange={(e) => props.onChange('projectId', e.target.value)} /></Field>
          <Field label="據點 ID"><input onChange={(e) => props.onChange('locationId', e.target.value)} /></Field>
          <Field label="申請說明" error={props.errors.description}><textarea onChange={(e) => props.onChange('description', e.target.value)} /></Field>
          <Field label="附件"><input type="file" multiple onChange={(e) => props.onChange('attachments', Array.from(e.target.files || []))} /></Field>
        </div>
        <TypeSpecificFields {...props} />
        <div className="actions">
          <button className="secondary">儲存草稿</button>
          <button className="primary" onClick={props.onSubmit}>送出申請</button>
        </div>
      </div>
    </section>
  );
}

function TypeSpecificFields(props: {
  selectedType: ApplicationType;
  errors: Record<string, string>;
  requiresQuotation: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const set = props.onChange;
  switch (props.selectedType) {
    case 'expense_reimbursement':
      return <FieldSet title="費用報銷"><Field label="費用日期"><input type="date" onChange={(e) => set('expenseDate', e.target.value)} /></Field><Field label="費用類別"><input onChange={(e) => set('expenseCategory', e.target.value)} /></Field><Field label="發票類型"><input onChange={(e) => set('invoiceType', e.target.value)} /></Field><Field label="發票號碼"><input onChange={(e) => set('invoiceNumber', e.target.value)} /></Field><Field label="統編"><input onChange={(e) => set('taxId', e.target.value)} /></Field><Field label="員工銀行帳戶 ID"><input onChange={(e) => set('employeeBankAccountId', e.target.value)} /></Field></FieldSet>;
    case 'payment_request':
      return <FieldSet title="付款申請"><Field label="受款人類型"><input onChange={(e) => set('payeeType', e.target.value)} /></Field><Field label="受款人名稱"><input onChange={(e) => set('payeeName', e.target.value)} /></Field><Field label="銀行名稱"><input onChange={(e) => set('payeeBankName', e.target.value)} /></Field><Field label="銀行帳號"><input onChange={(e) => set('payeeBankAccount', e.target.value)} /></Field><Field label="付款類別"><input onChange={(e) => set('paymentCategory', e.target.value)} /></Field><Field label="付款期限"><input type="date" onChange={(e) => set('dueDate', e.target.value)} /></Field><Check label="是否需扣繳" onChange={(v) => set('isWithholdingRequired', v)} /></FieldSet>;
    case 'advance_request':
      return <FieldSet title="預支申請"><Field label="預支用途"><input onChange={(e) => set('advancePurpose', e.target.value)} /></Field><Field label="預計使用日"><input type="date" onChange={(e) => set('expectedUsageDate', e.target.value)} /></Field><Field label="預計核銷日" error={props.errors.expectedSettlementDate}><input type="date" onChange={(e) => set('expectedSettlementDate', e.target.value)} /></Field><Field label="理由"><textarea onChange={(e) => set('reason', e.target.value)} /></Field><DetailHint text="advance_items：品項、預估金額、用途、預計付款對象" /></FieldSet>;
    case 'petty_cash_request':
      return <FieldSet title="零用金申請"><Field label="零用金據點 ID"><input onChange={(e) => set('pettyCashLocationId', e.target.value)} /></Field><Field label="申請類型"><select onChange={(e) => set('requestType', e.target.value)}><option value="new">新申請</option><option value="replenish">補足</option><option value="close">結清</option><option value="adjust_limit">調整額度</option></select></Field><Field label="申請金額"><input type="number" min={0} onChange={(e) => set('requestedAmount', Number(e.target.value))} /></Field><Field label="保管人 ID"><input onChange={(e) => set('custodianId', e.target.value)} /></Field><Field label="用途範圍"><textarea onChange={(e) => set('usageScope', e.target.value)} /></Field><DetailHint text="petty_cash_expense_items：支出日期、類別、金額、收據號碼、說明、附件" /></FieldSet>;
    case 'travel_request':
      return <FieldSet title="差旅申請"><Field label="差旅類型"><select onChange={(e) => set('travelType', e.target.value)}><option value="domestic">國內</option><option value="international">國外</option><option value="cross_county">跨縣市</option><option value="same_day">當日往返</option></select></Field><Field label="目的"><input onChange={(e) => set('purpose', e.target.value)} /></Field><Field label="目的地"><input onChange={(e) => set('destination', e.target.value)} /></Field><Field label="開始時間"><input type="datetime-local" onChange={(e) => set('startDatetime', e.target.value)} /></Field><Field label="結束時間"><input type="datetime-local" onChange={(e) => set('endDatetime', e.target.value)} /></Field><Check label="需要住宿" onChange={(v) => set('requiresAccommodation', v)} /><Check label="需要預支" onChange={(v) => set('requiresAdvance', v)} /></FieldSet>;
    case 'welfare_request':
      return <FieldSet title="福利申請"><Field label="福利類型"><input onChange={(e) => set('welfareType', e.target.value)} /></Field><Field label="事由"><textarea onChange={(e) => set('reason', e.target.value)} /></Field><Field label="事件日期"><input type="date" onChange={(e) => set('eventDate', e.target.value)} /></Field><Field label="年資月數"><input type="number" min={0} onChange={(e) => set('seniorityMonths', Number(e.target.value))} /></Field><Check label="併入薪資" onChange={(v) => set('includeInPayroll', v)} /><Check label="是否扣繳" onChange={(v) => set('isWithholdingRequired', v)} /></FieldSet>;
    case 'purchase_request':
      return <FieldSet title="採購申請"><Field label="採購類型"><input onChange={(e) => set('purchaseType', e.target.value)} /></Field><Field label="需求原因"><textarea onChange={(e) => set('reason', e.target.value)} /></Field><Check label="固定資產" onChange={(v) => set('isFixedAsset', v)} /><Check label="急件" onChange={(v) => set('isUrgent', v)} /><Field label="需求日期"><input type="date" onChange={(e) => set('requiredDate', e.target.value)} /></Field><Field label="預算來源"><input onChange={(e) => set('budgetSource', e.target.value)} /></Field>{props.requiresQuotation && <div className="notice">金額超過門檻，已標記需要比價。</div>}<DetailHint text="purchase_items：品名、規格、數量、單價、小計、用途、使用地點" /></FieldSet>;
    case 'refund_request':
      return <FieldSet title="退費申請"><Field label="退費對象類型"><input onChange={(e) => set('refundeeType', e.target.value)} /></Field><Field label="退費對象名稱"><input onChange={(e) => set('refundeeName', e.target.value)} /></Field><Field label="原收款日期"><input type="date" onChange={(e) => set('originalPaymentDate', e.target.value)} /></Field><Field label="原收款金額"><input type="number" min={0} onChange={(e) => set('originalPaymentAmount', Number(e.target.value))} /></Field><Field label="退費金額" error={props.errors.refundAmount}><input type="number" min={0} onChange={(e) => set('refundAmount', Number(e.target.value))} /></Field><Field label="退費原因"><textarea onChange={(e) => set('refundReason', e.target.value)} /></Field><Check label="需要折讓單" onChange={(v) => set('requiresAllowanceNote', v)} /></FieldSet>;
    case 'hr_expense_request':
      return <FieldSet title="人事費用申請"><Field label="受款人類型"><select onChange={(e) => set('payeeType', e.target.value)}><option value="employee">員工</option><option value="part_time">兼職</option><option value="external_lecturer">外部講師</option><option value="consultant">顧問</option><option value="care_worker">照服員</option></select></Field><Field label="受款人姓名"><input onChange={(e) => set('payeeName', e.target.value)} /></Field><Field label="費用類型"><input placeholder="薪資補發、獎金、津貼、加班費..." onChange={(e) => set('expenseType', e.target.value)} /></Field><Field label="薪資月份"><input type="month" onChange={(e) => set('payrollMonth', e.target.value)} /></Field><Field label="計算說明"><textarea onChange={(e) => set('calculationDescription', e.target.value)} /></Field><Check label="併入薪資" onChange={(v) => set('includeInPayroll', v)} /><Check label="是否扣繳" onChange={(v) => set('isWithholdingRequired', v)} /><Check label="需要勞保異動" onChange={(v) => set('requiresLaborInsuranceAction', v)} /></FieldSet>;
  }
}

function DetailPage() {
  return <Placeholder title="申請單詳情" lines={['申請內容', '附件', '審核紀錄', '付款紀錄', '會計分錄', 'audit log']} />;
}

function ReviewPage() {
  return <Placeholder title="審核頁" lines={['主管、會計、財務、人資待審清單', '核准', '退回', '駁回', '審核意見']} />;
}

function PaymentPage() {
  return <Placeholder title="付款作業" lines={['待付款清單', '付款日期', '付款金額', '付款方式', '交易序號', '付款狀態']} />;
}

function SettlementPage() {
  return <Placeholder title="核銷作業" lines={['預支核銷', '零用金支出明細', '附件', '多退少補計算', '核銷狀態']} />;
}

function Header({ title, subtitle }: { title: string; subtitle: string }) {
  return <div className="header"><h1>{title}</h1><p>{subtitle}</p></div>;
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{error && <em>{error}</em>}</label>;
}

function FieldSet({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="fieldset"><h3>{title}</h3><div className="form-grid">{children}</div></div>;
}

function Check({ label, onChange }: { label: string; onChange: (value: boolean) => void }) {
  return <label className="check"><input type="checkbox" onChange={(e) => onChange(e.target.checked)} />{label}</label>;
}

function DetailHint({ text }: { text: string }) {
  return <div className="hint">{text}</div>;
}

function Placeholder({ title, lines }: { title: string; lines: string[] }) {
  return <section><Header title={title} subtitle="接 API 後可替換為真實資料" /><div className="panel">{lines.map((line) => <div className="row" key={line}>{line}</div>)}</div></section>;
}

const styles = `
.acct-app{display:flex;min-height:100vh;background:#f6f7f9;color:#1f2937;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
aside{width:220px;background:#172033;color:white;padding:18px;display:flex;flex-direction:column;gap:8px}
.brand{font-weight:700;margin-bottom:14px}
aside button{border:0;background:transparent;color:#cbd5e1;text-align:left;padding:9px 10px;border-radius:6px;cursor:pointer}
aside button:hover{background:#26324a;color:white}
main{flex:1;padding:22px;overflow:auto}
.header h1{font-size:22px;margin:0 0 4px}
.header p{margin:0 0 18px;color:#64748b}
.filters,.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.panel,.table{background:white;border:1px solid #e5e7eb;border-radius:8px;padding:16px}
.type-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:14px}
.type{background:white;border:1px solid #dbe1ea;border-radius:8px;padding:12px;text-align:left;cursor:pointer}
.type.active{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.12)}
.type b{display:block;margin-bottom:4px}
.type small{color:#64748b}
.field{display:flex;flex-direction:column;gap:5px;font-size:13px}
.field span{font-weight:600;color:#475569}
input,select,textarea{border:1px solid #cbd5e1;border-radius:6px;padding:9px 10px;font:inherit;background:white}
textarea{min-height:80px}
em{font-style:normal;color:#dc2626;font-size:12px}
.fieldset{grid-column:1/-1;margin-top:16px;border-top:1px solid #eef2f7;padding-top:12px}
.check{display:flex;align-items:center;gap:8px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:6px;padding:10px}
.hint,.notice{background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;border-radius:6px;padding:10px;font-size:13px}
.actions{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
.primary{background:#2563eb;color:white;border:0;border-radius:6px;padding:10px 16px}
.secondary{background:white;color:#334155;border:1px solid #cbd5e1;border-radius:6px;padding:10px 16px}
.tr{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr 1fr 1fr;padding:10px;border-bottom:1px solid #eef2f7}
.th{font-weight:700;color:#475569;background:#f8fafc}
.empty{padding:24px;text-align:center;color:#94a3b8}
.row{padding:12px;border-bottom:1px solid #eef2f7}
`;

