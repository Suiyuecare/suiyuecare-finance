export type LeaveDeductionType = "事假" | "病假" | "生理假" | "特休" | "公假" | "無薪假";
export type SalaryBasis = "月薪" | "時薪";

export type LeaveDeductionRule = {
  leaveType: LeaveDeductionType;
  isPaid: boolean;
  payRatio: number;
  deductionRatio: number;
  deductAttendanceBonus: boolean;
  description: string;
};

export type LeaveDeductionRules = Record<LeaveDeductionType, LeaveDeductionRule>;

export type LeaveDeductionInput = {
  salaryBasis: SalaryBasis;
  monthlySalary: number;
  hourlyWage: number;
  leaveType: LeaveDeductionType;
  leaveHours: number;
  normalDailyHours: number;
  normalMonthlyDays: number;
  attendanceBonus: number;
  rules?: LeaveDeductionRules;
};

export type LeaveDeductionResult = {
  leaveType: LeaveDeductionType;
  salaryBasis: SalaryBasis;
  dailyWage: number;
  hourlyWage: number;
  leaveHours: number;
  paidAmount: number;
  deductionAmount: number;
  attendanceBonusDeduction: number;
  totalDeduction: number;
  rule: LeaveDeductionRule;
  details: Array<{
    label: string;
    amount: number;
    note: string;
  }>;
};

export const defaultLeaveDeductionRules: LeaveDeductionRules = {
  事假: {
    leaveType: "事假",
    isPaid: false,
    payRatio: 0,
    deductionRatio: 1,
    deductAttendanceBonus: true,
    description: "事假扣薪，預設不支薪，可依公司制度調整。",
  },
  病假: {
    leaveType: "病假",
    isPaid: true,
    payRatio: 0.5,
    deductionRatio: 0.5,
    deductAttendanceBonus: true,
    description: "病假半薪，預設扣薪 50%。",
  },
  生理假: {
    leaveType: "生理假",
    isPaid: true,
    payRatio: 0.5,
    deductionRatio: 0.5,
    deductAttendanceBonus: false,
    description: "生理假預設半薪，且不扣全勤。",
  },
  特休: {
    leaveType: "特休",
    isPaid: true,
    payRatio: 1,
    deductionRatio: 0,
    deductAttendanceBonus: false,
    description: "特休不扣薪。",
  },
  公假: {
    leaveType: "公假",
    isPaid: true,
    payRatio: 1,
    deductionRatio: 0,
    deductAttendanceBonus: false,
    description: "公假不扣薪。",
  },
  無薪假: {
    leaveType: "無薪假",
    isPaid: false,
    payRatio: 0,
    deductionRatio: 1,
    deductAttendanceBonus: true,
    description: "無薪假預設不支薪。",
  },
};

function roundMoney(value: number) {
  return Math.round(value);
}

export function calculateDailyWage(monthlySalary: number, normalMonthlyDays = 30) {
  if (monthlySalary <= 0 || normalMonthlyDays <= 0) return 0;
  return monthlySalary / normalMonthlyDays;
}

export function calculateHourlyWageFromMonthly(monthlySalary: number, normalDailyHours = 8, normalMonthlyDays = 30) {
  const dailyWage = calculateDailyWage(monthlySalary, normalMonthlyDays);
  if (normalDailyHours <= 0) return 0;
  return dailyWage / normalDailyHours;
}

export function calculateLeaveDeduction(input: LeaveDeductionInput): LeaveDeductionResult {
  const rules = input.rules ?? defaultLeaveDeductionRules;
  const rule = rules[input.leaveType];
  const leaveHours = Math.max(input.leaveHours, 0);
  const dailyWage = input.salaryBasis === "月薪" ? calculateDailyWage(input.monthlySalary, input.normalMonthlyDays) : input.hourlyWage * input.normalDailyHours;
  const hourlyWage =
    input.salaryBasis === "月薪"
      ? calculateHourlyWageFromMonthly(input.monthlySalary, input.normalDailyHours, input.normalMonthlyDays)
      : input.hourlyWage;
  const originalWageForLeaveHours = hourlyWage * leaveHours;
  const paidAmount = roundMoney(originalWageForLeaveHours * rule.payRatio);
  const deductionAmount = roundMoney(originalWageForLeaveHours * rule.deductionRatio);
  const attendanceBonusDeduction = rule.deductAttendanceBonus ? roundMoney(input.attendanceBonus * Math.min(leaveHours / (input.normalDailyHours * input.normalMonthlyDays), 1)) : 0;
  const totalDeduction = deductionAmount + attendanceBonusDeduction;

  return {
    leaveType: input.leaveType,
    salaryBasis: input.salaryBasis,
    dailyWage,
    hourlyWage,
    leaveHours,
    paidAmount,
    deductionAmount,
    attendanceBonusDeduction,
    totalDeduction,
    rule,
    details: [
      {
        label: input.salaryBasis === "月薪" ? "依月薪換算日薪" : "依時薪換算扣款",
        amount: roundMoney(input.salaryBasis === "月薪" ? dailyWage : hourlyWage),
        note: input.salaryBasis === "月薪" ? "月薪 ÷ 每月計薪日數" : "時薪直接作為扣款基礎",
      },
      {
        label: "假別支薪金額",
        amount: paidAmount,
        note: `${input.leaveType} 支薪比例 ${(rule.payRatio * 100).toFixed(0)}%`,
      },
      {
        label: "請假扣薪",
        amount: deductionAmount,
        note: `${input.leaveType} 扣薪比例 ${(rule.deductionRatio * 100).toFixed(0)}%`,
      },
      {
        label: "全勤扣款",
        amount: attendanceBonusDeduction,
        note: rule.deductAttendanceBonus ? "此假別設定為扣全勤，按請假時數比例估算" : "此假別設定為不扣全勤",
      },
    ],
  };
}

