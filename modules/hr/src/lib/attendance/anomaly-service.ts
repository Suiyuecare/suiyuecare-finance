export type AttendanceAnomalyType =
  | "late"
  | "early_leave"
  | "absence"
  | "missing_clock_in"
  | "missing_clock_out"
  | "location_anomaly"
  | "insufficient_work_hours"
  | "excessive_work_hours"
  | "insufficient_rest_time"
  | "non_scheduled_punch";

export type ShiftSchedule = {
  id: string;
  employeeId: string;
  employeeName: string;
  workDate: string;
  branchName: string;
  shiftName: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  plannedWorkMinutes: number;
  requiredRestMinutes: number;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  isScheduled: boolean;
};

export type AttendancePunchSummary = {
  employeeId: string;
  workDate: string;
  clockIn: string | null;
  clockOut: string | null;
  restMinutes: number;
  locationPassed: boolean;
  hasPunchOnNonScheduledDay?: boolean;
};

export type AttendanceAnomaly = {
  type: AttendanceAnomalyType;
  label: string;
  severity: "warning" | "critical";
  reason: string;
};

export type AttendanceAnomalyResult = {
  schedule: ShiftSchedule;
  punch: AttendancePunchSummary | null;
  actualWorkMinutes: number;
  anomalies: AttendanceAnomaly[];
};

export const anomalyLabels: Record<AttendanceAnomalyType, string> = {
  late: "遲到",
  early_leave: "早退",
  absence: "曠職",
  missing_clock_in: "未打上班卡",
  missing_clock_out: "未打下班卡",
  location_anomaly: "打卡地點異常",
  insufficient_work_hours: "工時不足",
  excessive_work_hours: "工時超過",
  insufficient_rest_time: "休息時間不足",
  non_scheduled_punch: "非排班日打卡",
};

function parseDateTime(value: string | null) {
  return value ? new Date(value).getTime() : null;
}

function getMinutesBetween(start: string | null, end: string | null) {
  const startTime = parseDateTime(start);
  const endTime = parseDateTime(end);

  if (startTime === null || endTime === null || endTime <= startTime) return 0;
  return Math.round((endTime - startTime) / 60000);
}

function createAnomaly(type: AttendanceAnomalyType, reason: string): AttendanceAnomaly {
  return {
    type,
    label: anomalyLabels[type],
    severity:
      type === "absence" ||
      type === "missing_clock_in" ||
      type === "missing_clock_out" ||
      type === "non_scheduled_punch"
        ? "critical"
        : "warning",
    reason,
  };
}

export function calculateAttendanceAnomalies(
  schedule: ShiftSchedule,
  punch: AttendancePunchSummary | null,
): AttendanceAnomalyResult {
  const anomalies: AttendanceAnomaly[] = [];
  const actualWorkMinutes =
    punch && punch.clockIn && punch.clockOut
      ? Math.max(0, getMinutesBetween(punch.clockIn, punch.clockOut) - punch.restMinutes)
      : 0;

  if (!schedule.isScheduled && punch?.hasPunchOnNonScheduledDay) {
    anomalies.push(createAnomaly("non_scheduled_punch", "員工於非排班日產生打卡紀錄。"));
  }

  if (schedule.isScheduled && !punch) {
    anomalies.push(createAnomaly("absence", "有班表但沒有任何打卡紀錄，判定為曠職待確認。"));
    return { schedule, punch, actualWorkMinutes, anomalies };
  }

  if (!punch) {
    return { schedule, punch, actualWorkMinutes, anomalies };
  }

  if (schedule.isScheduled && !punch.clockIn) {
    anomalies.push(createAnomaly("missing_clock_in", "班表有上班時間，但缺少上班打卡。"));
  }

  if (schedule.isScheduled && !punch.clockOut) {
    anomalies.push(createAnomaly("missing_clock_out", "班表有下班時間，但缺少下班打卡。"));
  }

  const plannedStart = parseDateTime(schedule.plannedStart);
  const plannedEnd = parseDateTime(schedule.plannedEnd);
  const clockIn = parseDateTime(punch.clockIn);
  const clockOut = parseDateTime(punch.clockOut);

  if (
    plannedStart !== null &&
    clockIn !== null &&
    clockIn - plannedStart > schedule.lateGraceMinutes * 60000
  ) {
    const lateMinutes = Math.round((clockIn - plannedStart) / 60000);
    anomalies.push(createAnomaly("late", `上班打卡晚於班表 ${lateMinutes} 分鐘。`));
  }

  if (
    plannedEnd !== null &&
    clockOut !== null &&
    plannedEnd - clockOut > schedule.earlyLeaveGraceMinutes * 60000
  ) {
    const earlyMinutes = Math.round((plannedEnd - clockOut) / 60000);
    anomalies.push(createAnomaly("early_leave", `下班打卡早於班表 ${earlyMinutes} 分鐘。`));
  }

  if (!punch.locationPassed) {
    anomalies.push(createAnomaly("location_anomaly", "GPS / Wi-Fi / IP 規則未通過。"));
  }

  if (
    schedule.isScheduled &&
    punch.clockIn &&
    punch.clockOut &&
    actualWorkMinutes < schedule.plannedWorkMinutes
  ) {
    anomalies.push(
      createAnomaly(
        "insufficient_work_hours",
        `實際工時 ${actualWorkMinutes} 分鐘，低於排班 ${schedule.plannedWorkMinutes} 分鐘。`,
      ),
    );
  }

  if (actualWorkMinutes > 12 * 60) {
    anomalies.push(createAnomaly("excessive_work_hours", `實際工時 ${actualWorkMinutes} 分鐘，超過 12 小時。`));
  }

  if (punch.clockIn && punch.clockOut && punch.restMinutes < schedule.requiredRestMinutes) {
    anomalies.push(
      createAnomaly(
        "insufficient_rest_time",
        `休息 ${punch.restMinutes} 分鐘，低於規則 ${schedule.requiredRestMinutes} 分鐘。`,
      ),
    );
  }

  return { schedule, punch, actualWorkMinutes, anomalies };
}

export const demoSchedules: ShiftSchedule[] = [
  {
    id: "sch-001",
    employeeId: "HC-018",
    employeeName: "林佳穎",
    workDate: "2026-05-18",
    branchName: "台北居服站",
    shiftName: "日班",
    plannedStart: "2026-05-18T09:00:00+08:00",
    plannedEnd: "2026-05-18T18:00:00+08:00",
    plannedWorkMinutes: 480,
    requiredRestMinutes: 60,
    lateGraceMinutes: 5,
    earlyLeaveGraceMinutes: 5,
    isScheduled: true,
  },
  {
    id: "sch-002",
    employeeId: "DC-009",
    employeeName: "黃冠宇",
    workDate: "2026-05-18",
    branchName: "新北日照中心",
    shiftName: "早班",
    plannedStart: "2026-05-18T08:00:00+08:00",
    plannedEnd: "2026-05-18T17:00:00+08:00",
    plannedWorkMinutes: 480,
    requiredRestMinutes: 60,
    lateGraceMinutes: 5,
    earlyLeaveGraceMinutes: 5,
    isScheduled: true,
  },
  {
    id: "sch-003",
    employeeId: "HC-026",
    employeeName: "王淑芬",
    workDate: "2026-05-18",
    branchName: "桃園據點",
    shiftName: "外勤",
    plannedStart: "2026-05-18T09:00:00+08:00",
    plannedEnd: "2026-05-18T18:00:00+08:00",
    plannedWorkMinutes: 480,
    requiredRestMinutes: 60,
    lateGraceMinutes: 10,
    earlyLeaveGraceMinutes: 10,
    isScheduled: true,
  },
  {
    id: "sch-004",
    employeeId: "FN-003",
    employeeName: "張雅雯",
    workDate: "2026-05-18",
    branchName: "總公司",
    shiftName: "休假",
    plannedStart: null,
    plannedEnd: null,
    plannedWorkMinutes: 0,
    requiredRestMinutes: 0,
    lateGraceMinutes: 0,
    earlyLeaveGraceMinutes: 0,
    isScheduled: false,
  },
  {
    id: "sch-005",
    employeeId: "OP-014",
    employeeName: "吳宗翰",
    workDate: "2026-05-18",
    branchName: "台中據點",
    shiftName: "日班",
    plannedStart: "2026-05-18T09:00:00+08:00",
    plannedEnd: "2026-05-18T18:00:00+08:00",
    plannedWorkMinutes: 480,
    requiredRestMinutes: 60,
    lateGraceMinutes: 5,
    earlyLeaveGraceMinutes: 5,
    isScheduled: true,
  },
];

export const demoPunches: AttendancePunchSummary[] = [
  {
    employeeId: "HC-018",
    workDate: "2026-05-18",
    clockIn: "2026-05-18T09:18:00+08:00",
    clockOut: "2026-05-18T17:40:00+08:00",
    restMinutes: 45,
    locationPassed: true,
  },
  {
    employeeId: "DC-009",
    workDate: "2026-05-18",
    clockIn: "2026-05-18T08:01:00+08:00",
    clockOut: null,
    restMinutes: 60,
    locationPassed: true,
  },
  {
    employeeId: "HC-026",
    workDate: "2026-05-18",
    clockIn: "2026-05-18T08:55:00+08:00",
    clockOut: "2026-05-18T22:30:00+08:00",
    restMinutes: 30,
    locationPassed: false,
  },
  {
    employeeId: "FN-003",
    workDate: "2026-05-18",
    clockIn: "2026-05-18T10:00:00+08:00",
    clockOut: "2026-05-18T12:00:00+08:00",
    restMinutes: 0,
    locationPassed: true,
    hasPunchOnNonScheduledDay: true,
  },
];
