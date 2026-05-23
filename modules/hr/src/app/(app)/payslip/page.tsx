"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Building2,
  CalendarDays,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Printer,
  Send,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  TimerReset,
  WalletCards,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type PayslipItem = {
  name: string;
  amount: number;
  note?: string;
};

type Payslip = {
  id: string;
  employeeUserId: string;
  employeeName: string;
  payrollMonth: string;
  paymentDate: string;
  bankAccountLastFive: string;
  earnings: PayslipItem[];
  deductions: PayslipItem[];
  employerContributions: PayslipItem[];
  netPay: number;
  remark: string;
  released: boolean;
  releasedAt: string;
  readAt?: string;
  sourceSummary: {
    attendanceDays: number;
    leaveHours: number;
    overtimeHours: number;
    abnormalCount: number;
    payrollStatus: string;
  };
};

const samplePayslipsForLayoutReference: Payslip[] = [
  {
    id: "SLIP-202605-hr-u3",
    employeeUserId: "hr-u3",
    employeeName: "陳羽俊",
    payrollMonth: "2026-05",
    paymentDate: "2026-06-05",
    bankAccountLastFive: "89012",
    earnings: [
      { name: "本薪", amount: 68000 },
      { name: "職務津貼", amount: 8000 },
      { name: "主管加給", amount: 6000 },
      { name: "全勤獎金", amount: 2000 },
      { name: "加班費", amount: 3120, note: "平日加班 6 小時" },
    ],
    deductions: [
      { name: "勞保自付", amount: 1145 },
      { name: "健保自付", amount: 710 },
      { name: "所得稅", amount: 4200 },
      { name: "其他扣款", amount: 0 },
    ],
    employerContributions: [
      { name: "勞保公司負擔", amount: 4008 },
      { name: "健保公司負擔", amount: 2198 },
      { name: "勞退公司提繳", amount: 4128 },
    ],
    netPay: 81065,
    remark: "本薪資單僅供本人查閱。如對內容有疑問，請於發薪後 5 個工作日內洽人資。",
    released: true,
    releasedAt: "2026-05-31 18:00",
    sourceSummary: {
      attendanceDays: 22,
      leaveHours: 0,
      overtimeHours: 6,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
  {
    id: "SLIP-202604-hr-u3",
    employeeUserId: "hr-u3",
    employeeName: "陳羽俊",
    payrollMonth: "2026-04",
    paymentDate: "2026-05-05",
    bankAccountLastFive: "89012",
    earnings: [
      { name: "本薪", amount: 68000 },
      { name: "職務津貼", amount: 8000 },
      { name: "主管加給", amount: 6000 },
      { name: "全勤獎金", amount: 2000 },
    ],
    deductions: [
      { name: "勞保自付", amount: 1145 },
      { name: "健保自付", amount: 710 },
      { name: "所得稅", amount: 4000 },
      { name: "其他扣款", amount: 0 },
    ],
    employerContributions: [
      { name: "勞保公司負擔", amount: 4008 },
      { name: "健保公司負擔", amount: 2198 },
      { name: "勞退公司提繳", amount: 4128 },
    ],
    netPay: 78145,
    remark: "薪資已於發薪日匯入指定帳戶。",
    released: true,
    releasedAt: "2026-04-30 18:00",
    sourceSummary: {
      attendanceDays: 21,
      leaveHours: 4,
      overtimeHours: 0,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
  {
    id: "SLIP-202605-hr-u1",
    employeeUserId: "hr-u1",
    employeeName: "潘雨柔",
    payrollMonth: "2026-05",
    paymentDate: "2026-06-05",
    bankAccountLastFive: "12345",
    earnings: [{ name: "本薪", amount: 42000 }],
    deductions: [{ name: "勞保自付", amount: 1098 }],
    employerContributions: [{ name: "勞退公司提繳", amount: 2634 }],
    netPay: 40902,
    remark: "此筆用於示範權限過濾，員工端不會顯示。",
    released: true,
    releasedAt: "2026-05-31 18:00",
    sourceSummary: {
      attendanceDays: 22,
      leaveHours: 8,
      overtimeHours: 0,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
  {
    id: "SLIP-202605-hr-u2",
    employeeUserId: "hr-u2",
    employeeName: "陳怡霖",
    payrollMonth: "2026-05",
    paymentDate: "2026-06-05",
    bankAccountLastFive: "66218",
    earnings: [{ name: "本薪", amount: 56000 }, { name: "主管加給", amount: 5000 }, { name: "加班費", amount: 1880 }],
    deductions: [{ name: "勞保自付", amount: 1145 }, { name: "健保自付", amount: 710 }],
    employerContributions: [{ name: "勞退公司提繳", amount: 3660 }],
    netPay: 61025,
    remark: "主管薪資單僅本人可見。",
    released: true,
    releasedAt: "2026-05-31 18:00",
    sourceSummary: {
      attendanceDays: 22,
      leaveHours: 0,
      overtimeHours: 4,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
  {
    id: "SLIP-202605-hr-u4",
    employeeUserId: "hr-u4",
    employeeName: "劉巧涵",
    payrollMonth: "2026-05",
    paymentDate: "2026-06-05",
    bankAccountLastFive: "70091",
    earnings: [{ name: "本薪", amount: 78000 }, { name: "職務津貼", amount: 12000 }],
    deductions: [{ name: "勞保自付", amount: 1266 }, { name: "健保自付", amount: 887 }, { name: "所得稅", amount: 5200 }],
    employerContributions: [{ name: "勞退公司提繳", amount: 5400 }],
    netPay: 82647,
    remark: "行政部門主任薪資單僅本人可見。",
    released: true,
    releasedAt: "2026-05-31 18:00",
    sourceSummary: {
      attendanceDays: 22,
      leaveHours: 0,
      overtimeHours: 0,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
  {
    id: "SLIP-202605-hr-u5",
    employeeUserId: "hr-u5",
    employeeName: "李佳泰",
    payrollMonth: "2026-05",
    paymentDate: "2026-06-05",
    bankAccountLastFive: "99801",
    earnings: [{ name: "本薪", amount: 120000 }, { name: "主管加給", amount: 20000 }],
    deductions: [{ name: "勞保自付", amount: 1266 }, { name: "健保自付", amount: 1419 }, { name: "所得稅", amount: 12800 }],
    employerContributions: [{ name: "勞退公司提繳", amount: 8400 }],
    netPay: 124515,
    remark: "執行長薪資單僅本人可見。",
    released: true,
    releasedAt: "2026-05-31 18:00",
    sourceSummary: {
      attendanceDays: 22,
      leaveHours: 0,
      overtimeHours: 0,
      abnormalCount: 0,
      payrollStatus: "已鎖定",
    },
  },
];
void samplePayslipsForLayoutReference;

const secureSessionSeconds = 5 * 60;

function formatNow() {
  return new Date().toLocaleString("zh-TW", { hour12: false });
}

function currency(value: number) {
  return new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(value);
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function toPayslipCsv(payslip: Payslip, totals: { earnings: number; deductions: number; employerContributions: number }) {
  const rows = [
    ["薪資月份", payslip.payrollMonth],
    ["員工", payslip.employeeName],
    ["發薪日期", payslip.paymentDate],
    ["匯款帳號末五碼", payslip.bankAccountLastFive],
    ["應發總額", totals.earnings],
    ["扣款總額", totals.deductions],
    ["公司負擔", totals.employerContributions],
    ["實發金額", payslip.netPay],
    [],
    ["分類", "項目", "金額", "備註"],
    ...payslip.earnings.map((item) => ["應發", item.name, item.amount, item.note ?? ""]),
    ...payslip.deductions.map((item) => ["扣款", item.name, item.amount, item.note ?? ""]),
    ...payslip.employerContributions.map((item) => ["公司負擔", item.name, item.amount, item.note ?? ""]),
  ];
  return "\uFEFF" + rows.map((row) => row.map((cell) => csvCell(cell ?? "")).join(",")).join("\n");
}

type PayslipRow = {
  id: string;
  employee_id: string;
  payroll_month: string;
  payment_date: string | null;
  bank_account_last_five: string | null;
  gross_pay_total: number | string;
  deduction_total: number | string;
  employer_cost_total: number | string;
  net_pay_total: number | string;
  items: PayslipItem[] | null;
  remark: string | null;
  status: string;
  released_at: string | null;
  employees: { full_name: string | null } | null;
};

function splitPayslipItems(row: PayslipRow) {
  const items = Array.isArray(row.items) ? row.items : [];
  const earnings = items.filter((item) => item.amount >= 0);
  const deductions = items.filter((item) => item.amount < 0).map((item) => ({ ...item, amount: Math.abs(item.amount) }));
  if (items.length) return { earnings, deductions, employerContributions: [] as PayslipItem[] };
  return {
    earnings: [{ name: "應發總額", amount: Number(row.gross_pay_total) }],
    deductions: [{ name: "扣款總額", amount: Number(row.deduction_total) }],
    employerContributions: [{ name: "公司負擔", amount: Number(row.employer_cost_total) }],
  };
}

function mapPayslipRow(row: PayslipRow, currentUserId: string): Payslip {
  const groups = splitPayslipItems(row);
  return {
    id: row.id,
    employeeUserId: currentUserId,
    employeeName: row.employees?.full_name ?? "",
    payrollMonth: String(row.payroll_month).slice(0, 7),
    paymentDate: row.payment_date ?? "",
    bankAccountLastFive: row.bank_account_last_five ?? "*****",
    earnings: groups.earnings,
    deductions: groups.deductions,
    employerContributions: groups.employerContributions,
    netPay: Number(row.net_pay_total),
    remark: row.remark ?? "",
    released: row.status === "released",
    releasedAt: row.released_at ? new Date(row.released_at).toLocaleString("zh-TW", { hour12: false }) : "",
    sourceSummary: {
      attendanceDays: 0,
      leaveHours: 0,
      overtimeHours: 0,
      abnormalCount: 0,
      payrollStatus: row.status === "released" ? "已發布" : row.status,
    },
  };
}

function getClient() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("Supabase 尚未設定，無法讀取薪資袋。");
  return supabase;
}

async function loadMyPayslips(currentUserId: string) {
  const supabase = getClient();
  const { data: profile, error: profileError } = await (supabase as any)
    .from("users")
    .select("employee_id")
    .eq("id", currentUserId)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.employee_id) return [];

  const { data, error } = await (supabase as any)
    .from("payroll_payslips")
    .select("*, employees(full_name)")
    .eq("employee_id", profile.employee_id)
    .eq("status", "released")
    .is("deleted_at", null)
    .order("payroll_month", { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PayslipRow[]).map((row) => mapPayslipRow(row, currentUserId));
}

async function loadPayslipReadLog(currentUserId: string) {
  const supabase = getClient();
  const { data, error } = await (supabase as any)
    .from("payroll_payslip_access")
    .select("read_log")
    .eq("user_id", currentUserId)
    .maybeSingle();
  if (error) throw error;
  return (data?.read_log ?? null) as Record<string, string> | null;
}

async function savePayslipReadLog(currentUserId: string, readLog: Record<string, string>) {
  const supabase = getClient();
  const { error } = await (supabase as any)
    .from("payroll_payslip_access")
    .update({ read_log: readLog, updated_at: new Date().toISOString() })
    .eq("user_id", currentUserId);
  if (error) throw error;
}

export default function PayslipPage() {
  const currentUser = useCurrentUser();
  const [myPayslips, setMyPayslips] = useState<Payslip[]>([]);
  const [selectedSlipId, setSelectedSlipId] = useState(myPayslips[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [readLog, setReadLog] = useState<Record<string, string>>({});
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [mustInitializePassword, setMustInitializePassword] = useState(false);
  const [loadMessage, setLoadMessage] = useState("");
  const [questionOpen, setQuestionOpen] = useState(false);
  const [questionCategory, setQuestionCategory] = useState("金額看不懂");
  const [questionText, setQuestionText] = useState("");
  const [questionMessage, setQuestionMessage] = useState("");
  const [secureSecondsLeft, setSecureSecondsLeft] = useState(secureSessionSeconds);
  const [maskAmounts, setMaskAmounts] = useState(false);
  const [securityMessage, setSecurityMessage] = useState("");
  const selectedSlip = myPayslips.find((payslip) => payslip.id === selectedSlipId) ?? myPayslips[0];

  useEffect(() => {
    let isMounted = true;
    async function loadPayslipState() {
      if (!currentUser.id) return;
      try {
        const [slips, remoteReadLog] = await Promise.all([
          loadMyPayslips(currentUser.id),
          loadPayslipReadLog(currentUser.id),
        ]);
        if (!isMounted) return;
        setMyPayslips(slips);
        setReadLog(remoteReadLog ?? {});
        setMustInitializePassword(remoteReadLog === null);
        setSelectedSlipId(slips[0]?.id ?? "");
      } catch (error) {
        if (!isMounted) return;
        setLoadMessage(error instanceof Error ? error.message : "讀取 Supabase 薪資袋失敗。");
      }
    }

    void loadPayslipState();
    setUnlocked(false);
    setPassword("");
    setPasswordError("");
    setPasswordMessage("");
    setChangePasswordOpen(false);
    return () => {
      isMounted = false;
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (!unlocked) return;
    setSecureSecondsLeft(secureSessionSeconds);
    const timer = window.setInterval(() => {
      setSecureSecondsLeft((current) => {
        if (current <= 1) {
          window.clearInterval(timer);
          setSecurityMessage("薪資袋已因閒置自動上鎖。");
          lockPayslip();
          return secureSessionSeconds;
        }
        return current - 1;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [unlocked, selectedSlipId]);

  const totals = useMemo(() => {
    if (!selectedSlip) {
      return { earnings: 0, deductions: 0, employerContributions: 0 };
    }
    return {
      earnings: selectedSlip.earnings.reduce((sum, item) => sum + item.amount, 0),
      deductions: selectedSlip.deductions.reduce((sum, item) => sum + item.amount, 0),
      employerContributions: selectedSlip.employerContributions.reduce((sum, item) => sum + item.amount, 0),
    };
	  }, [selectedSlip]);

  const formulaNetPay = totals.earnings - totals.deductions;
  const isFormulaMatched = selectedSlip ? formulaNetPay === selectedSlip.netPay : false;
  const secureAmount = (value: number) => (maskAmounts ? "••••••" : currency(value));

  async function appendSecurityLog(action: string) {
    if (!selectedSlip || !currentUser.id) return;
    const nowText = `${formatNow()} ${action}`;
    const nextReadLog = { ...readLog, [selectedSlip.id]: nowText };
    setReadLog(nextReadLog);
    await savePayslipReadLog(currentUser.id, nextReadLog);
    setSecurityMessage(nowText);
  }

  async function unlockPayslip() {
    const supabase = getClient();
    if (mustInitializePassword) {
      const { error } = await (supabase as any).rpc("initialize_payslip_password", {
        target_user_id: currentUser.id,
        initial_password: password,
      });
      if (error) {
        setPasswordError(error.message);
        return;
      }
      setMustInitializePassword(false);
    } else {
      const { data, error } = await (supabase as any).rpc("verify_payslip_password", {
        target_user_id: currentUser.id,
        plain_password: password,
      });
      if (error || !data) {
        setPasswordError(error?.message ?? "薪資袋密碼錯誤，請重新輸入。");
        return;
      }
    }
      setUnlocked(true);
      setSecureSecondsLeft(secureSessionSeconds);
      setPasswordError("");
      const nowText = formatNow();
      const nextReadLog = { ...readLog, [selectedSlip.id]: nowText };
      setReadLog(nextReadLog);
      await savePayslipReadLog(currentUser.id, nextReadLog);
  }

  function lockPayslip() {
    setUnlocked(false);
    setPassword("");
    setPasswordError("");
    setChangePasswordOpen(false);
    setMaskAmounts(false);
  }

  function extendSecureSession() {
    setSecureSecondsLeft(secureSessionSeconds);
    setSecurityMessage("已延長本次薪資袋安全檢視時間。");
  }

  async function changePayslipPassword() {
    if (nextPassword.length < 8) {
      setPasswordMessage("新密碼至少需要 8 碼。");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setPasswordMessage("新密碼與確認密碼不一致。");
      return;
    }

    const supabase = getClient();
    const { data, error } = await (supabase as any).rpc("set_payslip_password", {
      target_user_id: currentUser.id,
      current_password: currentPassword,
      next_password: nextPassword,
    });
    if (error || !data) {
      setPasswordMessage(error?.message ?? "目前密碼不正確。");
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
    setPasswordMessage("薪資袋密碼已更新。");
  }

  async function exportPayslipCsv() {
    if (!selectedSlip) return;
    await appendSecurityLog("匯出薪資單 CSV");
    downloadFile(
      `payslip-${selectedSlip.payrollMonth}-${currentUser.id}.csv`,
      toPayslipCsv(selectedSlip, totals),
      "text/csv;charset=utf-8",
    );
  }

  async function printPayslip() {
    await appendSecurityLog("列印薪資單");
    window.print();
  }

  function submitPayslipQuestion() {
    if (!questionText.trim()) {
      setQuestionMessage("請先簡短描述想詢問的地方。");
      return;
    }
    setQuestionMessage(`已建立薪資疑問：${questionCategory}。人資會依 ${selectedSlip.payrollMonth} 薪資單回覆。`);
    setQuestionText("");
  }

  if (!selectedSlip) {
    return (
      <Card className="rounded-lg">
        <CardContent className="p-8 text-center">
        <LockKeyhole className="mx-auto h-10 w-10 text-slate-400" />
        <h1 className="mt-4 text-xl font-semibold text-slate-950">尚無可查看的電子薪資單</h1>
        <p className="mt-2 text-sm text-slate-500">{loadMessage || "員工只能查看自己的薪資單，未發布或非本人薪資單不會出現在此頁。"}</p>
        </CardContent>
      </Card>
    );
  }

  if (!unlocked) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="rounded-lg border-[#f0c987]">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-[#fff3de] text-[#b45309]">
              <LockKeyhole className="h-7 w-7" />
            </div>
            <h1 className="mt-4 text-xl font-black text-slate-950">薪資袋密碼驗證</h1>
            <p className="mt-2 text-sm text-slate-500">
              薪資袋只查詢目前登入者本人的已發布薪資單，{mustInitializePassword ? "首次使用請設定至少 8 碼薪資袋密碼。" : "請輸入你設定的薪資袋密碼。"}
            </p>
            <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-left text-sm">
              <div className="mb-2 flex items-center gap-2 font-bold text-emerald-900">
                <ShieldCheck className="h-4 w-4" />
                安心保護
              </div>
              <div className="grid gap-1 text-emerald-800">
                <span>只讀取本人 employee_id 的薪資單</span>
                <span>只顯示已發布薪資月份</span>
                <span>解鎖與切換月份會記錄讀取時間</span>
                <span>解鎖後 5 分鐘未延長會自動上鎖</span>
              </div>
            </div>
            <div className="mt-3 rounded-lg border bg-slate-50 p-3 text-left text-sm">
              <div className="font-bold text-slate-900">{currentUser.name}</div>
              <div className="mt-1 text-slate-500">{currentUser.roleLabel} · {currentUser.email}</div>
              <div className="mt-1 text-slate-500">可查看薪資單：{myPayslips.length} 份</div>
            </div>
            <div className="mx-auto mt-5 flex max-w-sm gap-2">
              <div className="relative min-w-0 flex-1">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setPasswordError("");
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") unlockPayslip();
                  }}
                  className="h-10 w-full rounded-md border border-[#dfc9b1] px-3 pr-10 text-sm outline-none focus:border-[#d97706]"
                  placeholder="請輸入薪資袋密碼"
                />
                <button
                  type="button"
                  className="absolute right-2 top-2.5 text-slate-500"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "隱藏密碼" : "顯示密碼"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button onClick={unlockPayslip}>解鎖</Button>
            </div>
            {passwordError ? <p className="mt-3 text-sm font-semibold text-rose-600">{passwordError}</p> : null}
          <p className="mt-4 text-xs text-slate-500">忘記薪資袋密碼時，請洽人資重設；系統不會在頁面上顯示完整銀行帳號。</p>
          {securityMessage ? <p className="mt-3 text-xs font-semibold text-emerald-700">{securityMessage}</p> : null}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">Employee Payslip</p>
          <h1 className="text-2xl font-semibold text-slate-950">電子薪資單</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            這裡只顯示你本人的已發布薪資單。金額來源、扣款、公司負擔與讀取紀錄都會清楚列出。
          </p>
        </div>
	        <div className="flex flex-wrap gap-2">
	          <select
	            value={selectedSlipId}
	            onChange={(event) => {
	              setSelectedSlipId(event.target.value);
	              const nowText = formatNow();
	              const nextReadLog = { ...readLog, [event.target.value]: nowText };
	              setReadLog(nextReadLog);
	              void savePayslipReadLog(currentUser.id, nextReadLog);
	            }}
	            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
	          >
            {myPayslips.map((payslip) => (
              <option key={payslip.id} value={payslip.id}>
                {payslip.payrollMonth}
              </option>
            ))}
          </select>
	          <span className="inline-flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">
	            <ShieldCheck className="h-4 w-4" />
	            僅本人可見
	          </span>
	          <Button variant="outline" onClick={exportPayslipCsv}>
	            <Download className="h-4 w-4" />
	            匯出 CSV
	          </Button>
	          <Button variant="outline" onClick={printPayslip}>
	            <Printer className="h-4 w-4" />
	            列印
	          </Button>
            <Button variant="outline" onClick={() => setMaskAmounts((current) => !current)}>
              {maskAmounts ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {maskAmounts ? "顯示金額" : "遮蔽金額"}
            </Button>
	          <Button variant="outline" onClick={lockPayslip}>
	            <RotateCcw className="h-4 w-4" />
	            重新上鎖
	          </Button>
	        </div>
	      </div>

      <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
            <div>
              <h2 className="font-black text-emerald-950">你的薪資資料目前是安全檢視</h2>
              <p className="mt-1 text-sm text-emerald-800">
                系統已用登入帳號對應的員工 ID 查詢薪資袋，只顯示本人資料；銀行帳號只顯示末五碼。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-bold text-emerald-900">
            <span className="rounded-full bg-white px-3 py-1">本人限定</span>
            <span className="rounded-full bg-white px-3 py-1">已發布才可看</span>
            <span className="rounded-full bg-white px-3 py-1">讀取留痕</span>
            <span className="rounded-full bg-white px-3 py-1">自動上鎖</span>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[#ead8c2] bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-[#fff3de] p-2 text-[#b45309]">
              <TimerReset className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-black text-slate-950">安全檢視工作階段</h2>
              <p className="mt-1 text-sm text-slate-500">
                薪資袋已解鎖，請避免在公共裝置或投影畫面停留。倒數結束會自動上鎖；匯出、列印、切換月份都會留下紀錄。
              </p>
              {securityMessage ? <p className="mt-2 text-sm font-semibold text-emerald-700">{securityMessage}</p> : null}
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[420px]">
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-500">自動上鎖倒數</div>
              <div className="mt-1 text-lg font-black text-slate-950">{formatCountdown(secureSecondsLeft)}</div>
            </div>
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-xs font-bold text-slate-500">螢幕保護</div>
              <div className="mt-1 text-lg font-black text-slate-950">{maskAmounts ? "金額已遮蔽" : "金額顯示中"}</div>
            </div>
            <Button variant="outline" onClick={extendSecureSession}>
              <TimerReset className="h-4 w-4" />
              延長 5 分鐘
            </Button>
          </div>
        </div>
      </section>

	      <section className="grid gap-4 md:grid-cols-3">
	        <Card className="rounded-lg border-emerald-200 bg-emerald-50">
	          <CardContent className="p-4">
	            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
	              <ShieldCheck className="h-4 w-4" />
	              權限狀態
	            </div>
	            <div className="mt-2 text-xl font-black text-emerald-950">本人薪資袋</div>
	            <div className="mt-1 text-xs text-emerald-700">目前只顯示 {currentUser.name} 的已發布薪資單。</div>
	          </CardContent>
	        </Card>
	        <Card className="rounded-lg">
	          <CardContent className="p-4">
	            <div className="text-sm font-semibold text-slate-500">發布時間</div>
	            <div className="mt-2 text-xl font-black text-slate-950">{selectedSlip.releasedAt}</div>
	            <div className="mt-1 text-xs text-slate-500">薪資狀態：{selectedSlip.sourceSummary.payrollStatus}</div>
	          </CardContent>
	        </Card>
	        <Card className="rounded-lg">
	          <CardContent className="p-4">
	            <div className="text-sm font-semibold text-slate-500">本人讀取紀錄</div>
	            <div className="mt-2 text-xl font-black text-slate-950">{readLog[selectedSlip.id] ?? "尚未記錄"}</div>
	            <div className="mt-1 text-xs text-slate-500">解鎖或切換月份時自動更新。</div>
	          </CardContent>
	        </Card>
	      </section>

	      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "薪資月份", value: selectedSlip.payrollMonth, icon: CalendarDays, tone: "bg-sky-50 text-sky-700" },
          { label: "發薪日期", value: selectedSlip.paymentDate, icon: Banknote, tone: "bg-emerald-50 text-emerald-700" },
          { label: "匯款帳號末五碼", value: selectedSlip.bankAccountLastFive, icon: LockKeyhole, tone: "bg-amber-50 text-amber-700" },
          { label: "實發金額", value: secureAmount(selectedSlip.netPay), icon: WalletCards, tone: "bg-violet-50 text-violet-700" },
	        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-slate-500">{item.label}</p>
              <span className={`rounded-lg p-2 ${item.tone}`}>
                <item.icon className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-3 text-2xl font-semibold text-slate-950">{item.value}</p>
          </div>
	        ))}
	      </section>

	      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
	        {[
	          { label: "出勤天數", value: `${selectedSlip.sourceSummary.attendanceDays} 天` },
	          { label: "請假時數", value: `${selectedSlip.sourceSummary.leaveHours} 小時` },
	          { label: "加班時數", value: `${selectedSlip.sourceSummary.overtimeHours} 小時` },
	          { label: "出勤異常", value: `${selectedSlip.sourceSummary.abnormalCount} 件` },
	          { label: "公式檢核", value: isFormulaMatched ? "一致" : "需複核" },
	        ].map((item) => (
	          <Card key={item.label} className="rounded-lg">
	            <CardContent className="p-4">
	              <p className="text-sm text-slate-500">{item.label}</p>
	              <p className="mt-2 text-xl font-black text-slate-950">{item.value}</p>
	            </CardContent>
	          </Card>
	        ))}
	      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">薪資明細</h2>
                <p className="text-sm text-slate-500">{selectedSlip.employeeName} · {selectedSlip.payrollMonth}</p>
              </div>
              <Eye className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-2">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <ReceiptText className="h-5 w-5 text-emerald-700" />
                <h3 className="font-semibold text-emerald-900">應發項目</h3>
              </div>
              <div className="space-y-2">
                {selectedSlip.earnings.map((item) => (
                  <div key={item.name} className="flex items-start justify-between gap-4 rounded-lg bg-white/80 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium text-slate-800">{item.name}</p>
                      {item.note ? <p className="text-xs text-slate-500">{item.note}</p> : null}
                    </div>
                    <span className="font-semibold text-emerald-700">{secureAmount(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
              <div className="mb-3 flex items-center gap-2">
                <LockKeyhole className="h-5 w-5 text-rose-700" />
                <h3 className="font-semibold text-rose-900">扣款項目</h3>
              </div>
              <div className="space-y-2">
                {selectedSlip.deductions.map((item) => (
                  <div key={item.name} className="flex items-center justify-between gap-4 rounded-lg bg-white/80 px-3 py-2 text-sm">
                    <span className="font-medium text-slate-800">{item.name}</span>
                    <span className="font-semibold text-rose-700">{secureAmount(item.amount)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Building2 className="h-5 w-5 text-sky-700" />
              <h2 className="text-lg font-semibold text-slate-950">公司負擔項</h2>
            </div>
            <div className="space-y-2">
              {selectedSlip.employerContributions.map((item) => (
                <div key={item.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className="text-slate-700">{item.name}</span>
                  <span className="font-semibold text-slate-900">{secureAmount(item.amount)}</span>
                </div>
              ))}
            </div>
          </div>

	          <div className="rounded-lg border border-violet-200 bg-violet-50 p-5">
	            <h2 className="font-semibold text-violet-900">薪資彙總</h2>
	            <div className="mt-4 space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-violet-800">應發總額</span>
                <span className="font-semibold text-violet-950">{secureAmount(totals.earnings)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-violet-800">扣款總額</span>
                <span className="font-semibold text-violet-950">{secureAmount(totals.deductions)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-violet-800">公司負擔</span>
                <span className="font-semibold text-violet-950">{secureAmount(totals.employerContributions)}</span>
              </div>
	              <div className="border-t border-violet-200 pt-3">
	                <div className="flex items-center justify-between">
	                  <span className="font-semibold text-violet-900">實發金額</span>
	                  <span className="text-2xl font-semibold text-violet-950">{secureAmount(selectedSlip.netPay)}</span>
	                </div>
	                <div className="mt-2 flex items-center justify-between text-xs">
	                  <span className="text-violet-800">應發 - 扣款</span>
	                  <span className="font-semibold text-violet-950">{secureAmount(formulaNetPay)}</span>
	                </div>
	                <Badge className={`mt-3 ${isFormulaMatched ? "bg-emerald-600" : "bg-amber-600"}`}>
	                  {isFormulaMatched ? "公式檢核一致" : "公式檢核需複核"}
	                </Badge>
                  <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs leading-5 text-violet-800">
                    計算方式：應發總額 {secureAmount(totals.earnings)} - 扣款總額 {secureAmount(totals.deductions)} ={" "}
                    {secureAmount(formulaNetPay)}。若與實發金額不同，頁面會提醒需複核。
                  </div>
	              </div>
	            </div>
	          </div>

	          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
	            <h2 className="font-semibold text-amber-900">備註</h2>
	            <p className="mt-2 text-sm text-amber-800">{selectedSlip.remark}</p>
	          </div>

            <div className="rounded-lg border border-sky-200 bg-sky-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-sky-700" />
                  <h2 className="text-lg font-semibold text-sky-950">看不懂或覺得有誤？</h2>
                </div>
                <Button variant="outline" size="sm" onClick={() => setQuestionOpen((current) => !current)}>
                  {questionOpen ? "收合" : "提出疑問"}
                </Button>
              </div>
              <p className="mt-2 text-sm text-sky-800">
                可以先提出疑問，不會影響薪資單本身；人資會依薪資月份與項目回覆。
              </p>
              {questionOpen ? (
                <div className="mt-4 space-y-3">
                  <select
                    value={questionCategory}
                    onChange={(event) => setQuestionCategory(event.target.value)}
                    className="h-10 w-full rounded-md border border-sky-200 bg-white px-3 text-sm"
                  >
                    {["金額看不懂", "加班費疑問", "請假扣薪疑問", "勞健保扣款疑問", "匯款帳號疑問", "其他"].map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                  <textarea
                    value={questionText}
                    onChange={(event) => setQuestionText(event.target.value)}
                    className="min-h-24 w-full rounded-md border border-sky-200 bg-white px-3 py-2 text-sm"
                    placeholder="請描述你想確認的項目，例如：5 月加班費好像少算 2 小時。"
                  />
                  <Button onClick={submitPayslipQuestion}>
                    <Send className="h-4 w-4" />
                    送出疑問
                  </Button>
                  {questionMessage ? (
                    <p className={`text-sm font-semibold ${questionMessage.includes("已建立") ? "text-emerald-700" : "text-rose-700"}`}>
                      {questionMessage}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>

	          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
	            <div className="flex items-center justify-between gap-3">
	              <div className="flex items-center gap-2">
	                <KeyRound className="h-5 w-5 text-slate-700" />
	                <h2 className="text-lg font-semibold text-slate-950">薪資袋密碼</h2>
	              </div>
	              <Button variant="outline" size="sm" onClick={() => setChangePasswordOpen((current) => !current)}>
	                {changePasswordOpen ? "收合" : "變更密碼"}
	              </Button>
	            </div>
	            {changePasswordOpen ? (
	              <div className="mt-4 space-y-3">
	                <input
	                  type="password"
	                  value={currentPassword}
	                  onChange={(event) => setCurrentPassword(event.target.value)}
	                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
	                  placeholder="目前密碼"
	                />
	                <input
	                  type="password"
	                  value={nextPassword}
	                  onChange={(event) => setNextPassword(event.target.value)}
	                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
	                  placeholder="新密碼"
	                />
	                <input
	                  type="password"
	                  value={confirmPassword}
	                  onChange={(event) => setConfirmPassword(event.target.value)}
	                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
	                  placeholder="再次輸入新密碼"
	                />
	                <Button onClick={changePayslipPassword}>儲存新密碼</Button>
	                {passwordMessage ? (
	                  <p className={`text-sm font-semibold ${passwordMessage.includes("已更新") ? "text-emerald-700" : "text-rose-700"}`}>
	                    {passwordMessage}
	                  </p>
	                ) : null}
	              </div>
	            ) : (
	              <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
                  <div className="flex items-center gap-2 font-semibold text-slate-800">
                    <KeyRound className="h-4 w-4" />
                    密碼建議
                  </div>
                  <p className="mt-1">
                    請使用至少 8 碼且不與登入密碼相同的薪資袋密碼。若系統由舊版預設密碼移轉，建議第一次解鎖後立即變更。
                  </p>
                </div>
	            )}
	          </div>
	        </div>
	      </section>

	      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
	        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 text-slate-700" />
          <div>
	            <h2 className="font-semibold text-slate-950">薪資單權限控管</h2>
	            <p className="mt-1 text-sm text-slate-500">
	              此頁會先查詢目前登入者對應的 employee_id，再用 employee_id 讀取已發布薪資單；一般員工不能切換查看他人薪資袋。正式上線仍需搭配 Supabase RLS、API 權限驗證與 audit logs。
	            </p>
	            <div className="mt-3 grid gap-2 text-sm text-slate-600 md:grid-cols-3">
	              <div className="rounded-lg bg-slate-50 p-3">
	                <CheckCircle2 className="mb-2 h-4 w-4 text-emerald-700" />
	                只顯示本人已發布薪資單。
	              </div>
	              <div className="rounded-lg bg-slate-50 p-3">
	                <LockKeyhole className="mb-2 h-4 w-4 text-slate-700" />
	                薪資袋密碼保護本人端檢視。
	              </div>
	              <div className="rounded-lg bg-slate-50 p-3">
	                <ShieldCheck className="mb-2 h-4 w-4 text-slate-700" />
	                讀取時間已留存，匯出與列印需進 audit logs。
	              </div>
	            </div>
	          </div>
	        </div>
	      </section>
    </div>
  );
}
