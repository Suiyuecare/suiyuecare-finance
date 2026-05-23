export type ComplianceSeverity = "blocking" | "warning";

export type ComplianceIssue = {
  code: string;
  severity: ComplianceSeverity;
  law: "勞動基準法" | "性別平等工作法" | "公司法" | "民法" | "系統內控";
  article: string;
  title: string;
  message: string;
  remediation: string;
  sourceUrl: string;
};

export type ComplianceResult = {
  checkedAt: string;
  blocked: boolean;
  issues: ComplianceIssue[];
};

type RequestComplianceInput = {
  formId: string;
  values: Record<string, string>;
  reason: string;
  attachmentNames: string[];
};

export type LeaveRuleComplianceInput = {
  leaveType: string;
  paidRatio: number;
  annualLimitDays?: number;
  minUnitHours?: number;
  affectsAttendanceBonus?: boolean;
  requiresAttachment?: boolean;
};

export type PayrollItemComplianceInput = {
  itemName: string;
  itemType: "earning" | "deduction" | "employer_cost" | "tax" | "memo";
  amount: number;
  employeeConsent?: boolean;
  legalBasis?: string;
};

export type ScheduleComplianceItem = {
  id: string;
  date: string;
  employee: string;
  shift: string;
  time: string;
};

export type PayrollComplianceInput = {
  employees: number;
  needsReview: number;
  locked: boolean;
  published: boolean;
  rosterRows: Array<{
    employeeNo: string;
    name: string;
    bankCode: string;
    bankAccount: string;
    grossPay: number;
    netPay: number;
    status: string;
  }>;
};

export type SettingComplianceInput = {
  category: string;
  status: string;
  fields: string[];
};

const laborStandardsUrl = "https://laws.mol.gov.tw/FLAW/FLAWDAT01.aspx?id=FL014930";
const genderEqualityUrl = "https://laws.mol.gov.tw/FLAW/FLAWDAT01.aspx?id=FL015149";
const officialLaborStandardsUrl = "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030001";
const officialGenderEqualityUrl = "https://law.moj.gov.tw/LawClass/LawAll.aspx?pcode=N0030014";
const minimumWage2026Url = "https://www.mol.gov.tw/1607/28162/28166/28180/28182/28188/29022/?cprint=pt";
const minimumMonthlyWage2026 = 29500;
const minimumHourlyWage2026 = 196;

function now() {
  return new Date().toLocaleString("zh-TW", { hour12: false });
}

function result(issues: ComplianceIssue[]): ComplianceResult {
  return {
    checkedAt: now(),
    blocked: issues.some((issue) => issue.severity === "blocking"),
    issues,
  };
}

function blocking(issue: Omit<ComplianceIssue, "severity">): ComplianceIssue {
  return { ...issue, severity: "blocking" };
}

function warning(issue: Omit<ComplianceIssue, "severity">): ComplianceIssue {
  return { ...issue, severity: "warning" };
}

function parseHours(value: string | undefined) {
  const hours = Number(value ?? 0);
  return Number.isFinite(hours) ? hours : 0;
}

function parseTimeRangeHours(start: string | undefined, end: string | undefined) {
  if (!start || !end) return 0;
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((value) => !Number.isFinite(value))) return 0;
  const startTotal = startHour * 60 + startMinute;
  let endTotal = endHour * 60 + endMinute;
  if (endTotal <= startTotal) endTotal += 24 * 60;
  return (endTotal - startTotal) / 60;
}

function timeRangeWorkHours(time: string) {
  if (time === "-" || !time.includes("-")) return 0;
  const [start, end] = time.split("-");
  return parseTimeRangeHours(start, end);
}

function dateKey(value: string) {
  return new Date(`${value}T00:00:00+08:00`).getTime();
}

function scheduleStartEnd(item: ScheduleComplianceItem) {
  if (item.time === "-" || !item.time.includes("-")) return null;
  const [start, end] = item.time.split("-");
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  if ([startHour, startMinute, endHour, endMinute].some((value) => !Number.isFinite(value))) return null;
  const startDate = new Date(`${item.date}T00:00:00+08:00`);
  startDate.setHours(startHour, startMinute, 0, 0);
  const endDate = new Date(`${item.date}T00:00:00+08:00`);
  endDate.setHours(endHour, endMinute, 0, 0);
  if (endDate <= startDate) endDate.setDate(endDate.getDate() + 1);
  return { start: startDate.getTime(), end: endDate.getTime() };
}

function restHoursBetween(previous: ScheduleComplianceItem, current: ScheduleComplianceItem) {
  const previousRange = scheduleStartEnd(previous);
  const currentRange = scheduleStartEnd(current);
  if (!previousRange || !currentRange) return -1;
  return (currentRange.start - previousRange.end) / (1000 * 60 * 60);
}

function isScheduledShift(shift: string) {
  return !["休假", "特休", "國定假日"].includes(shift);
}

export function isAttachmentRequiredForRequest(formId: string, values: Record<string, string>) {
  const leaveType = values["假別"];
  if (formId === "leave" && ["生理假", "家庭照顧假", "特休", "公假"].includes(leaveType)) {
    return false;
  }

  return ["punch", "meeting-minutes", "incident-report", "company-seal-request", "equipment-repair", "asset-disposal"].includes(formId) || (formId === "leave" && ["病假", "產假", "陪產檢及陪產假"].includes(leaveType));
}

export function validateRequestSubmission(input: RequestComplianceInput): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  if (input.formId === "leave") {
    const leaveType = input.values["假別"];
    const leaveHours = parseHours(input.values["請假時數"]);
    const needsAttachment = isAttachmentRequiredForRequest(input.formId, input.values);

    if (needsAttachment && input.attachmentNames.length === 0) {
      issues.push(blocking({
        code: "REQ_ATTACHMENT_REQUIRED",
        law: "系統內控",
        article: "文件證明與稽核留痕",
        title: "此假別需要附件才能送出",
        message: `${leaveType || "此假別"}需要附件佐證，避免後續薪資、出勤與簽核無法稽核。`,
        remediation: "請補上證明文件，或改存草稿待資料完整後再送出。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    if (leaveType === "生理假" && leaveHours > 8) {
      issues.push(blocking({
        code: "GENDER_MENSTRUAL_LEAVE_DAILY_LIMIT",
        law: "性別平等工作法",
        article: "生理假最低保障",
        title: "生理假單次時數超過系統法規底線",
        message: "生理假以每月一日為基本保障，單次申請超過 8 小時需拆單或由人資專案確認。",
        remediation: "請將本次生理假調整為 8 小時以內，或改由人資建立專案紀錄。",
        sourceUrl: genderEqualityUrl,
      }));
    }

    if (leaveType === "家庭照顧假" && leaveHours > 56) {
      issues.push(blocking({
        code: "GENDER_FAMILY_CARE_ANNUAL_LIMIT",
        law: "性別平等工作法",
        article: "家庭照顧假最低保障",
        title: "家庭照顧假單次申請超過年度法定天數",
        message: "家庭照顧假全年以 7 日作為法定基準，單次申請不可超過 56 小時。",
        remediation: "請拆分申請，並由人資確認年度已用額度。",
        sourceUrl: genderEqualityUrl,
      }));
    }

    if (["產假", "產檢假", "陪產檢及陪產假", "家庭照顧假", "育嬰留職停薪"].includes(leaveType)) {
      issues.push(warning({
        code: "GENDER_PROTECTED_LEAVE_NO_ADVERSE_ACTION",
        law: "性別平等工作法",
        article: "禁止不利處分",
        title: "性別平等保護假別",
        message: "此假別不得作為考績、調薪、陞遷、訓練、解僱或其他不利待遇依據。",
        remediation: "送出後應由系統保留保護假別標記，後續人事異動需重新檢核。",
        sourceUrl: genderEqualityUrl,
      }));
    }

    if (["產檢假", "陪產檢及陪產假"].includes(leaveType) && leaveHours > 56) {
      issues.push(blocking({
        code: "GENDER_PRENATAL_PATERNITY_LEAVE_LIMIT",
        law: "性別平等工作法",
        article: "第 15 條",
        title: "產檢假或陪產檢及陪產假超過七日底線",
        message: "產檢假、陪產檢及陪產假為七日且薪資照給，單次送出不可超過 56 小時。",
        remediation: "請調整為 56 小時以內，或由人資建立跨期專案紀錄。",
        sourceUrl: officialGenderEqualityUrl,
      }));
    }

    if (leaveType === "育嬰留職停薪" && !input.reason.match(/子女|育嬰|照顧|撫育/)) {
      issues.push(blocking({
        code: "GENDER_PARENTAL_LEAVE_REASON_REQUIRED",
        law: "性別平等工作法",
        article: "第 16 條",
        title: "育嬰留職停薪缺少撫育事由",
        message: "育嬰留職停薪需保留子女與期間等稽核資料，避免後續復職與保險權益斷點。",
        remediation: "請補充子女年齡、預計期間與復職日期，或改由人資建立留停紀錄。",
        sourceUrl: officialGenderEqualityUrl,
      }));
    }
  }

  if (input.formId === "overtime" || input.formId === "pre-overtime") {
    const overtimeType = input.values["加班類型"];
    const overtimeHours = parseTimeRangeHours(
      input.values["開始時間"] || input.values["預計開始時間"],
      input.values["結束時間"] || input.values["預計結束時間"],
    );

    if (overtimeHours <= 0) {
      issues.push(blocking({
        code: "LSA_OVERTIME_TIME_RANGE",
        law: "勞動基準法",
        article: "延長工作時間",
        title: "加班時段不成立",
        message: "加班開始與結束時間無法換算出有效時數。",
        remediation: "請重新填寫加班開始時間與結束時間。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    if (overtimeType === "平日加班" && overtimeHours > 4) {
      issues.push(blocking({
        code: "LSA_DAILY_WORK_HOURS_LIMIT",
        law: "勞動基準法",
        article: "每日工時與延長工時上限",
        title: "平日加班超過每日工時底線",
        message: "以每日正常工時 8 小時計，平日加班超過 4 小時會使單日工時高於 12 小時。",
        remediation: "請縮短加班時數、拆分排程，或由人資確認是否有合法例外程序。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    const monthlyOvertime = parseHours(input.values["本月加班累計"]);
    if (monthlyOvertime + overtimeHours > 46 && input.values["勞資會議同意"] !== "是") {
      issues.push(blocking({
        code: "LSA_MONTHLY_OVERTIME_LIMIT",
        law: "勞動基準法",
        article: "第 32 條",
        title: "月加班時數超過 46 小時且缺少合法程序",
        message: `本月累計加班 ${monthlyOvertime + overtimeHours} 小時，超過一般每月 46 小時上限。`,
        remediation: "請確認是否已有工會或勞資會議同意、三個月總量控管與必要備查紀錄；沒有紀錄不可送出。",
        sourceUrl: officialLaborStandardsUrl,
      }));
    }

    if (overtimeType === "例假日出勤" && !/(天災|事變|突發|緊急)/.test(input.reason)) {
      issues.push(blocking({
        code: "LSA_REGULAR_HOLIDAY_EXCEPTION_REQUIRED",
        law: "勞動基準法",
        article: "例假日出勤限制",
        title: "例假日出勤缺少法定例外原因",
        message: "例假日出勤屬高風險情境，申請原因需明確載明天災、事變、突發或緊急事由。",
        remediation: "請補充法定例外原因，否則不可送出例假日出勤申請。",
        sourceUrl: laborStandardsUrl,
      }));
    }
  }

  if (input.formId === "punch" && input.attachmentNames.length === 0) {
    issues.push(blocking({
      code: "PUNCH_CORRECTION_EVIDENCE_REQUIRED",
      law: "系統內控",
      article: "出勤紀錄更正稽核",
      title: "補打卡缺少附件或佐證",
      message: "補打卡會回寫出勤與薪資來源，必須保留佐證避免薪資結算爭議。",
      remediation: "請上傳服務紀錄、截圖、主管說明或其他佐證。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  return result(issues);
}

export function validateSchedulePublication(schedules: ScheduleComplianceItem[]): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  const byEmployee = new Map<string, ScheduleComplianceItem[]>();
  const seen = new Set<string>();

  schedules.forEach((item) => {
    const duplicateKey = `${item.employee}-${item.date}-${item.time}`;
    if (seen.has(duplicateKey) && isScheduledShift(item.shift)) {
      issues.push(blocking({
        code: "SCHEDULE_DUPLICATE_SHIFT",
        law: "系統內控",
        article: "班表防呆",
        title: "同一員工同日同時段重複排班",
        message: `${item.employee} 在 ${item.date} 的 ${item.time} 已有重複排班。`,
        remediation: "請刪除重複班別或改派其他人員。",
        sourceUrl: laborStandardsUrl,
      }));
    }
    seen.add(duplicateKey);

    const workHours = timeRangeWorkHours(item.time);
    if (workHours > 12) {
      issues.push(blocking({
        code: "SCHEDULE_DAILY_HOURS_LIMIT",
        law: "勞動基準法",
        article: "每日工時上限",
        title: "單日排班工時超過 12 小時",
        message: `${item.employee} 在 ${item.date} 排班 ${workHours} 小時，超過每日工時底線。`,
        remediation: "請縮短班別、拆班，或改由合法例外程序處理。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    if (!byEmployee.has(item.employee)) byEmployee.set(item.employee, []);
    byEmployee.get(item.employee)?.push(item);
  });

  byEmployee.forEach((items, employee) => {
    const employeeItems = items
      .filter((item) => isScheduledShift(item.shift))
      .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    const scheduledDates = Array.from(new Set(employeeItems.map((item) => item.date))).sort();

    for (let index = 1; index < employeeItems.length; index += 1) {
      const previous = employeeItems[index - 1];
      const current = employeeItems[index];
      const restHours = restHoursBetween(previous, current);
      if (restHours >= 0 && restHours < 11) {
        issues.push(blocking({
          code: "SCHEDULE_SHIFT_REST_INTERVAL",
          law: "勞動基準法",
          article: "第 34 條",
          title: "輪班間隔低於十一小時",
          message: `${employee} 從 ${previous.date} ${previous.time} 到 ${current.date} ${current.time} 之間僅休息 ${restHours.toFixed(1)} 小時。`,
          remediation: "請調整班別或改派人員；若屬合法例外，需先補齊勞資程序與備查紀錄。",
          sourceUrl: officialLaborStandardsUrl,
        }));
      }
    }

    scheduledDates.forEach((date) => {
      const windowItems = items.filter((item) => isScheduledShift(item.shift) && dateKey(item.date) - dateKey(date) >= 0 && dateKey(item.date) - dateKey(date) <= 6 * 24 * 60 * 60 * 1000);
      const weeklyHours = windowItems.reduce((sum, item) => sum + timeRangeWorkHours(item.time), 0);
      if (weeklyHours > 40) {
        issues.push(warning({
          code: "SCHEDULE_WEEKLY_NORMAL_HOURS_REVIEW",
          law: "勞動基準法",
          article: "第 30 條",
          title: "七日區間正常工時超過四十小時",
          message: `${employee} 自 ${date} 起七日內排班 ${weeklyHours} 小時，超出每週正常工時 40 小時的底線。`,
          remediation: "超過 40 小時的部分需進入加班申請、補償與薪資計算，不可只作為一般班表發布。",
          sourceUrl: officialLaborStandardsUrl,
        }));
      }
      if (weeklyHours > 48) {
        issues.push(blocking({
          code: "SCHEDULE_WEEKLY_HOURS_LIMIT",
          law: "勞動基準法",
          article: "第 30 條、第 32 條",
          title: "七日區間排班總工時過高",
          message: `${employee} 自 ${date} 起七日內排班 ${weeklyHours} 小時，超過一般週工時與延長工時可接受底線。`,
          remediation: "請降低週排班、補足休息日，或建立合法彈性工時與勞資程序紀錄。",
          sourceUrl: officialLaborStandardsUrl,
        }));
      }
    });

    scheduledDates.forEach((date, index) => {
      const window = scheduledDates.slice(index).filter((nextDate) => dateKey(nextDate) - dateKey(date) <= 6 * 24 * 60 * 60 * 1000);
      if (window.length > 6) {
        issues.push(blocking({
          code: "SCHEDULE_SEVEN_DAY_REST_REQUIRED",
          law: "勞動基準法",
          article: "每七日例假與休息日",
          title: "七日區間缺少足夠休息日",
          message: `${employee} 自 ${date} 起七日內排了 ${window.length} 個工作日，低於例假與休息日底線。`,
          remediation: "請安排例假與休息日，或改用已核准的彈性工時制度並保留勞資程序紀錄。",
          sourceUrl: officialLaborStandardsUrl,
        }));
      }
    });
  });

  return result(issues);
}

export function validatePayrollClosing(input: PayrollComplianceInput): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  if (input.employees <= 0) {
    issues.push(blocking({
      code: "PAYROLL_NO_EMPLOYEES",
      law: "系統內控",
      article: "薪資結算完整性",
      title: "沒有可結算員工",
      message: "薪資批次沒有任何員工資料，不能鎖定或發布。",
      remediation: "請先同步員工、出勤與薪資草稿。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  if (input.needsReview > 0) {
    issues.push(blocking({
      code: "PAYROLL_ATTENDANCE_REVIEW_REQUIRED",
      law: "勞動基準法",
      article: "工資與出勤紀錄",
      title: "仍有出勤或薪資來源待檢查",
      message: `目前尚有 ${input.needsReview} 筆需要檢查，不能鎖定薪資。`,
      remediation: "請先完成異常出勤、補卡、請假、加班與扣款檢查。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  input.rosterRows.forEach((row) => {
    if (!row.bankCode || !row.bankAccount) {
      issues.push(blocking({
        code: "PAYROLL_BANK_ACCOUNT_REQUIRED",
        law: "系統內控",
        article: "薪資發放稽核",
        title: "銀行資料不完整",
        message: `${row.name} 缺少銀行代碼或帳號，不能發布薪資或匯出轉帳檔。`,
        remediation: "請補齊員工薪資帳戶資料。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    if (row.netPay < 0 || row.grossPay < 0) {
      issues.push(blocking({
        code: "PAYROLL_NEGATIVE_PAY",
        law: "勞動基準法",
        article: "工資給付",
        title: "薪資金額不可為負數",
        message: `${row.name} 的應發或實發金額為負數，可能低於工資給付底線。`,
        remediation: "請檢查扣款、請假扣薪與薪資項目設定。",
        sourceUrl: laborStandardsUrl,
      }));
    }

    if (row.grossPay > 0 && row.grossPay < minimumMonthlyWage2026) {
      issues.push(blocking({
        code: "PAYROLL_MINIMUM_WAGE_MONTHLY_2026",
        law: "勞動基準法",
        article: "第 21 條、最低工資法",
        title: "月薪低於 2026 最低工資",
        message: `${row.name} 的應發薪資 ${row.grossPay.toLocaleString("zh-TW")} 元低於 2026 年月薪最低工資 ${minimumMonthlyWage2026.toLocaleString("zh-TW")} 元。`,
        remediation: "請調整薪資主檔、工時計算或確認是否為非完整月薪資；未補齊前不得發布薪資。",
        sourceUrl: minimumWage2026Url,
      }));
    }

    if (row.grossPay > 0 && row.netPay === 0) {
      issues.push(blocking({
        code: "PAYROLL_ZERO_NET_PAY_REVIEW",
        law: "勞動基準法",
        article: "第 22 條、第 26 條",
        title: "實發薪資為零需人工覆核",
        message: `${row.name} 有應發薪資但實發為 0，可能涉及不當扣款或預扣工資。`,
        remediation: "請檢查扣款合法依據、勞工同意與法令依據，未補齊不得發布。",
        sourceUrl: officialLaborStandardsUrl,
      }));
    }
  });

  if (input.published && !input.locked) {
    issues.push(blocking({
      code: "PAYROLL_RELEASE_REQUIRES_LOCK",
      law: "系統內控",
      article: "薪資發布程序",
      title: "薪資單發布前必須先鎖定",
      message: "薪資單不可在未鎖定批次的狀態下發布。",
      remediation: "請先完成薪資鎖定並保留調整紀錄。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  return result(issues);
}

export function validateLeaveRulePublication(rules: LeaveRuleComplianceInput[]): ComplianceResult {
  const issues: ComplianceIssue[] = [];
  const byType = new Map(rules.map((rule) => [rule.leaveType, rule]));

  const requiredTypes = ["特休", "病假", "事假", "生理假", "產假", "產檢假", "陪產檢及陪產假", "家庭照顧假", "育嬰留職停薪"];
  requiredTypes.forEach((type) => {
    if (!byType.has(type)) {
      issues.push(blocking({
        code: "LEAVE_RULE_REQUIRED_TYPE_MISSING",
        law: type === "特休" ? "勞動基準法" : "性別平等工作法",
        article: type === "特休" ? "第 38 條" : "第 14 條至第 21 條",
        title: `假別規則缺少 ${type}`,
        message: `系統未設定 ${type}，會造成員工送件、薪資扣薪或不利處分判斷斷點。`,
        remediation: `請建立 ${type} 的支薪比例、最小單位、年度額度、附件規則與全勤影響。`,
        sourceUrl: type === "特休" ? officialLaborStandardsUrl : officialGenderEqualityUrl,
      }));
    }
  });

  const menstrual = byType.get("生理假");
  if (menstrual && menstrual.paidRatio < 0.5) {
    issues.push(blocking({
      code: "LEAVE_RULE_MENSTRUAL_PAY_TOO_LOW",
      law: "性別平等工作法",
      article: "第 14 條",
      title: "生理假支薪比例低於法規底線",
      message: "生理假薪資不得低於半薪底線。",
      remediation: "請將生理假支薪比例調整為 50% 以上。",
      sourceUrl: officialGenderEqualityUrl,
    }));
  }

  const prenatal = byType.get("產檢假");
  const paternity = byType.get("陪產檢及陪產假");
  [prenatal, paternity].forEach((rule) => {
    if (rule && rule.paidRatio < 1) {
      issues.push(blocking({
        code: "LEAVE_RULE_PRENATAL_PATERNITY_FULL_PAY",
        law: "性別平等工作法",
        article: "第 15 條",
        title: `${rule.leaveType} 必須薪資照給`,
        message: `${rule.leaveType} 期間薪資照給，設定不可低於 100%。`,
        remediation: "請將支薪比例調整為 100%，不得扣全勤或作不利處分。",
        sourceUrl: officialGenderEqualityUrl,
      }));
    }
  });

  const familyCare = byType.get("家庭照顧假");
  if (familyCare && familyCare.annualLimitDays && familyCare.annualLimitDays < 7) {
    issues.push(blocking({
      code: "LEAVE_RULE_FAMILY_CARE_TOO_LOW",
      law: "性別平等工作法",
      article: "第 20 條",
      title: "家庭照顧假年度額度低於七日",
      message: "家庭照顧假全年以七日為限，系統設定不可少於七日。",
      remediation: "請將年度額度調整為至少七日，並標記不得影響全勤、考績或不利處分。",
      sourceUrl: officialGenderEqualityUrl,
    }));
  }

  rules.forEach((rule) => {
    if (["生理假", "產假", "產檢假", "陪產檢及陪產假", "家庭照顧假", "育嬰留職停薪"].includes(rule.leaveType) && rule.affectsAttendanceBonus) {
      issues.push(blocking({
        code: "LEAVE_RULE_PROTECTED_ADVERSE_ACTION",
        law: "性別平等工作法",
        article: "第 21 條",
        title: `${rule.leaveType} 不得影響全勤或造成不利處分`,
        message: `${rule.leaveType} 被設定為影響全勤或考績，低於性別平等工作法底線。`,
        remediation: "請取消扣全勤與不利處分設定，並加上保護假別標記。",
        sourceUrl: officialGenderEqualityUrl,
      }));
    }

    if (rule.minUnitHours && rule.minUnitHours > 8) {
      issues.push(blocking({
        code: "LEAVE_RULE_MIN_UNIT_TOO_LARGE",
        law: "系統內控",
        article: "假勤申請可近用性",
        title: `${rule.leaveType} 最小請假單位過大`,
        message: `${rule.leaveType} 的最小請假單位為 ${rule.minUnitHours} 小時，會讓員工無法依實際需求申請部分時段。`,
        remediation: "請將最小請假單位調整為 8 小時以內；常用建議為 1 小時或 0.5 小時。",
        sourceUrl: officialLaborStandardsUrl,
      }));
    }
  });

  return result(issues);
}

export function validatePayrollItemPublication(items: PayrollItemComplianceInput[]): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  items.forEach((item) => {
    if (item.itemType === "deduction" && item.amount > 0 && !item.employeeConsent && !item.legalBasis) {
      issues.push(blocking({
        code: "PAYROLL_DEDUCTION_BASIS_REQUIRED",
        law: "勞動基準法",
        article: "第 22 條、第 26 條",
        title: "扣款項目缺少法令或員工同意依據",
        message: `${item.itemName} 是扣款項目，但缺少法令依據或員工同意紀錄。`,
        remediation: "請補上法令依據、勞雇約定或員工同意紀錄；否則不可發布薪資項目。",
        sourceUrl: officialLaborStandardsUrl,
      }));
    }

    if (item.itemType === "earning" && item.amount < 0) {
      issues.push(blocking({
        code: "PAYROLL_EARNING_NEGATIVE",
        law: "系統內控",
        article: "薪資項目完整性",
        title: "加項不可為負數",
        message: `${item.itemName} 是薪資加項但金額為負數。`,
        remediation: "請改為扣項並補齊扣款合法依據。",
        sourceUrl: officialLaborStandardsUrl,
      }));
    }

    if (item.itemType === "earning" && item.itemName.includes("時薪") && item.amount > 0 && item.amount < minimumHourlyWage2026) {
      issues.push(blocking({
        code: "PAYROLL_MINIMUM_WAGE_HOURLY_2026",
        law: "勞動基準法",
        article: "第 21 條、最低工資法",
        title: "時薪低於 2026 最低工資",
        message: `${item.itemName} 設定為 ${item.amount} 元，低於 2026 年時薪最低工資 ${minimumHourlyWage2026} 元。`,
        remediation: "請將時薪設定調整為 196 元以上，或建立優於法規的公司標準。",
        sourceUrl: minimumWage2026Url,
      }));
    }
  });

  return result(issues);
}

export function validateSettingPublication(input: SettingComplianceInput): ComplianceResult {
  const issues: ComplianceIssue[] = [];

  if (input.status !== "已啟用") {
    issues.push(blocking({
      code: "SETTING_STATUS_NOT_READY",
      law: "系統內控",
      article: "設定發布控管",
      title: "設定尚未通過檢查",
      message: `${input.category} 目前狀態為「${input.status}」，不得發布到正式系統。`,
      remediation: "請先完成欄位、權限、跨模組引用與法規底線檢查，狀態改為已啟用後再發布。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  if (input.category === "假別規則") {
    const requiredLeaveRules = ["特休", "病假", "生理假", "產假", "產檢假", "陪產檢及陪產假", "家庭照顧假", "育嬰留職停薪"];
    const missingRules = requiredLeaveRules.filter((rule) => !input.fields.join("、").includes(rule));
    if (missingRules.length > 0) {
      issues.push(blocking({
        code: "SETTING_PROTECTED_LEAVE_RULES_REQUIRED",
        law: "性別平等工作法",
        article: "保護假別",
        title: "保護假別規則不完整",
        message: `假別規則缺少：${missingRules.join("、")}。`,
        remediation: "請補齊法定與性別平等保護假別，並設定支薪、扣全勤、附件與額度規則。",
        sourceUrl: genderEqualityUrl,
      }));
    }
  }

  if (input.category === "通知設定" && !input.fields.join("、").includes("性騷擾")) {
    issues.push(blocking({
      code: "SETTING_SEXUAL_HARASSMENT_CHANNEL_REQUIRED",
      law: "性別平等工作法",
      article: "第 13 條",
      title: "通知設定缺少性騷擾申訴管道",
      message: "僱用達一定人數時，雇主須公開申訴管道或防治措施；系統通知設定需保留公告與通知能力。",
      remediation: "請補上性騷擾申訴管道、調查通知、地方主管機關通報與保密流程。",
      sourceUrl: officialGenderEqualityUrl,
    }));
  }

  if (input.category === "加班規則" && !input.fields.join("、").includes("上限")) {
    issues.push(blocking({
      code: "SETTING_OVERTIME_LIMIT_REQUIRED",
      law: "勞動基準法",
      article: "延長工時上限",
      title: "加班規則缺少上限控管",
      message: "加班規則必須包含每日、每月與例假日出勤限制。",
      remediation: "請補上加班上限、例假日例外原因、補休轉換與加班費倍率設定。",
      sourceUrl: laborStandardsUrl,
    }));
  }

  if (input.category === "班別規則" && !input.fields.join("、").includes("11 小時")) {
    issues.push(blocking({
      code: "SETTING_SHIFT_REST_INTERVAL_REQUIRED",
      law: "勞動基準法",
      article: "第 34 條",
      title: "班別規則缺少輪班休息間隔",
      message: "班別規則必須包含輪班換班至少 11 小時休息的底線。",
      remediation: "請補上 11 小時休息間隔、合法例外程序與備查欄位。",
      sourceUrl: officialLaborStandardsUrl,
    }));
  }

  return result(issues);
}

export function formatComplianceMessage(compliance: ComplianceResult) {
  if (compliance.blocked) {
    const first = compliance.issues.find((issue) => issue.severity === "blocking");
    return first ? `法規檢核未通過：${first.title}` : "法規檢核未通過。";
  }

  if (compliance.issues.length > 0) {
    return `法規檢核通過，但有 ${compliance.issues.length} 項提醒需留意。`;
  }

  return "法規檢核通過，可以進入下一步。";
}
