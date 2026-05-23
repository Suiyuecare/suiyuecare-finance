export type OvertimeDayType = "平日加班" | "休息日加班" | "例假日出勤" | "國定假日出勤";
export type OvertimeCompensation = "加班費" | "補休";

export type OvertimeRuleSegment = {
  fromHour: number;
  toHour: number | null;
  multiplier: number;
  label: string;
};

export type OvertimeRules = {
  normalMonthlyHours: number;
  dailyOvertimeLimitHours: number;
  monthlyOvertimeLimitHours: number;
  dayTypeRules: Record<OvertimeDayType, OvertimeRuleSegment[]>;
  compensatoryLeaveRate: Record<OvertimeDayType, number>;
};

export type OvertimeCalculationInput = {
  monthlySalary: number;
  overtimeHours: number;
  dayType: OvertimeDayType;
  compensation: OvertimeCompensation;
  monthAccumulatedHours: number;
  rules?: OvertimeRules;
};

export type OvertimePayDetail = {
  label: string;
  hours: number;
  multiplier: number;
  hourlyWage: number;
  amount: number;
};

export type OvertimeCalculationResult = {
  dayType: OvertimeDayType;
  compensation: OvertimeCompensation;
  hourlyWage: number;
  overtimeHours: number;
  totalPay: number;
  compensatoryLeaveHours: number;
  details: OvertimePayDetail[];
  warnings: string[];
};

export const taiwanDefaultOvertimeRules: OvertimeRules = {
  normalMonthlyHours: 240,
  dailyOvertimeLimitHours: 12,
  monthlyOvertimeLimitHours: 46,
  dayTypeRules: {
    平日加班: [
      { fromHour: 0, toHour: 2, multiplier: 4 / 3, label: "平日前 2 小時" },
      { fromHour: 2, toHour: null, multiplier: 5 / 3, label: "平日第 3 小時起" },
    ],
    休息日加班: [
      { fromHour: 0, toHour: 2, multiplier: 4 / 3, label: "休息日前 2 小時" },
      { fromHour: 2, toHour: 8, multiplier: 5 / 3, label: "休息日第 3 至 8 小時" },
      { fromHour: 8, toHour: null, multiplier: 8 / 3, label: "休息日第 9 小時起" },
    ],
    例假日出勤: [
      { fromHour: 0, toHour: 8, multiplier: 2, label: "例假日 8 小時內" },
      { fromHour: 8, toHour: 10, multiplier: 4 / 3, label: "例假日超過 8 小時第 1 至 2 小時" },
      { fromHour: 10, toHour: null, multiplier: 5 / 3, label: "例假日超過 10 小時後" },
    ],
    國定假日出勤: [
      { fromHour: 0, toHour: 8, multiplier: 2, label: "國定假日 8 小時內" },
      { fromHour: 8, toHour: 10, multiplier: 4 / 3, label: "國定假日超過 8 小時第 1 至 2 小時" },
      { fromHour: 10, toHour: null, multiplier: 5 / 3, label: "國定假日超過 10 小時後" },
    ],
  },
  compensatoryLeaveRate: {
    平日加班: 1,
    休息日加班: 1,
    例假日出勤: 1,
    國定假日出勤: 1,
  },
};

function roundMoney(value: number) {
  return Math.round(value);
}

function getSegmentHours(totalHours: number, segment: OvertimeRuleSegment) {
  const segmentEnd = segment.toHour ?? totalHours;
  return Math.max(Math.min(totalHours, segmentEnd) - segment.fromHour, 0);
}

export function calculateHourlyWage(monthlySalary: number, normalMonthlyHours = taiwanDefaultOvertimeRules.normalMonthlyHours) {
  if (monthlySalary <= 0 || normalMonthlyHours <= 0) return 0;
  return monthlySalary / normalMonthlyHours;
}

export function calculateOvertimePay(input: OvertimeCalculationInput): OvertimeCalculationResult {
  const rules = input.rules ?? taiwanDefaultOvertimeRules;
  const overtimeHours = Math.max(input.overtimeHours, 0);
  const hourlyWage = calculateHourlyWage(input.monthlySalary, rules.normalMonthlyHours);
  const details = rules.dayTypeRules[input.dayType].map((segment) => {
    const hours = getSegmentHours(overtimeHours, segment);
    return {
      label: segment.label,
      hours,
      multiplier: segment.multiplier,
      hourlyWage,
      amount: roundMoney(hours * hourlyWage * segment.multiplier),
    };
  }).filter((detail) => detail.hours > 0);

  const totalPay = input.compensation === "加班費" ? details.reduce((sum, detail) => sum + detail.amount, 0) : 0;
  const compensatoryLeaveHours =
    input.compensation === "補休" ? overtimeHours * rules.compensatoryLeaveRate[input.dayType] : 0;

  const warnings: string[] = [];
  if (overtimeHours > rules.dailyOvertimeLimitHours) {
    warnings.push(`加班時數上限提醒：單日 ${overtimeHours} 小時已超過 ${rules.dailyOvertimeLimitHours} 小時。`);
  }
  if (input.monthAccumulatedHours + overtimeHours > rules.monthlyOvertimeLimitHours) {
    warnings.push(`加班時數上限提醒：本月累計將達 ${input.monthAccumulatedHours + overtimeHours} 小時，超過 ${rules.monthlyOvertimeLimitHours} 小時。`);
  }
  if (input.dayType === "例假日出勤") {
    warnings.push("例假日出勤屬高風險情境，應確認是否符合緊急、天災、突發事件或法定例外。");
  }
  if (input.compensation === "補休") {
    warnings.push("補休轉換需由勞雇雙方協商同意，未於期限內補休完畢時仍需依法折算加班費。");
  }

  return {
    dayType: input.dayType,
    compensation: input.compensation,
    hourlyWage,
    overtimeHours,
    totalPay,
    compensatoryLeaveHours,
    details,
    warnings,
  };
}

