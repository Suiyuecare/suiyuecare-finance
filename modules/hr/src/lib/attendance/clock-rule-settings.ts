export type PunchType = "clock_in" | "clock_out" | "out" | "return";
export type RuleMethod = "GPS" | "Wi-Fi" | "IP" | "送審";
export type ClockDayType = "weekday" | "rest_day" | "regular_holiday" | "national_holiday";
export type ClockPolicyMode = "fixed_site" | "remote_allowed" | "field_service";
export type WeekdayKey = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export type ClockLocationRule = {
  id: string;
  name: string;
  type: "company_branch" | "homecare_service" | "remote";
  latitude: number;
  longitude: number;
  radiusMeters: number;
  address: string;
  allowAbnormalSubmit: boolean;
};

export type NetworkClockRule = {
  id: string;
  branchName: string;
  allowedWifiSsids: string[];
  allowedIpAddresses: string[];
  forceRestriction: boolean;
  allowAbnormalReview: boolean;
};

export type DayClockRule = {
  label: string;
  requireGps: boolean;
  requireNetwork: boolean;
  allowRemote: boolean;
  blockIfOutside: boolean;
  allowAbnormalReview: boolean;
  radiusMeters: number;
};

export type EmployeeClockPolicy = {
  employeeNo: string;
  employeeName: string;
  policyMode: ClockPolicyMode;
  primaryLocationRuleId: string;
  remoteAllowed: boolean;
  radiusOverrideMeters: number | null;
  note: string;
};

export type ClockRuleSettings = {
  mode: "four_week_flexible" | "regular_week";
  effectiveFrom: string;
  fourWeekCycleStartDate: string;
  regularHolidayWeekdays: WeekdayKey[];
  restDayWeekdays: WeekdayKey[];
  defaultPolicyMode: ClockPolicyMode;
  defaultRadiusMeters: number;
  dayRules: Record<ClockDayType, DayClockRule>;
  locationRules: ClockLocationRule[];
  networkRules: NetworkClockRule[];
  employeePolicies: EmployeeClockPolicy[];
  legalNotes: string[];
};

export const weekdayLabels: Record<WeekdayKey, string> = {
  monday: "週一",
  tuesday: "週二",
  wednesday: "週三",
  thursday: "週四",
  friday: "週五",
  saturday: "週六",
  sunday: "週日",
};

export const dayTypeLabels: Record<ClockDayType, string> = {
  weekday: "平日",
  rest_day: "休息日",
  regular_holiday: "例假日",
  national_holiday: "國定假日",
};

export const policyModeLabels: Record<ClockPolicyMode, string> = {
  fixed_site: "定點上班",
  remote_allowed: "可遠端",
  field_service: "外勤/居服服務點",
};

export const defaultClockLocationRules: ClockLocationRule[] = [
  {
    id: "branch-hq",
    name: "總公司",
    type: "company_branch",
    latitude: 25.0478,
    longitude: 121.517,
    radiusMeters: 120,
    address: "台北市中正區仁愛路一段 1 號",
    allowAbnormalSubmit: true,
  },
  {
    id: "branch-admin",
    name: "行政辦公室",
    type: "company_branch",
    latitude: 25.033,
    longitude: 121.5654,
    radiusMeters: 120,
    address: "台北市信義區松仁路 100 號",
    allowAbnormalSubmit: true,
  },
];

export const defaultNetworkClockRules: NetworkClockRule[] = [
  {
    id: "net-hq",
    branchName: "總公司",
    allowedWifiSsids: ["SuiYue-HQ", "SuiYue-Admin"],
    allowedIpAddresses: ["203.0.113.18", "203.0.113.19"],
    forceRestriction: true,
    allowAbnormalReview: true,
  },
  {
    id: "net-admin",
    branchName: "行政辦公室",
    allowedWifiSsids: ["SuiYue-Office", "SuiYue-Admin"],
    allowedIpAddresses: ["198.51.100.24"],
    forceRestriction: false,
    allowAbnormalReview: true,
  },
];

export const defaultClockRuleSettings: ClockRuleSettings = {
  mode: "four_week_flexible",
  effectiveFrom: "2026-05-01",
  fourWeekCycleStartDate: "2026-05-04",
  regularHolidayWeekdays: ["sunday"],
  restDayWeekdays: ["saturday"],
  defaultPolicyMode: "fixed_site",
  defaultRadiusMeters: 120,
  dayRules: {
    weekday: {
      label: "平日",
      requireGps: true,
      requireNetwork: false,
      allowRemote: false,
      blockIfOutside: false,
      allowAbnormalReview: true,
      radiusMeters: 120,
    },
    rest_day: {
      label: "休息日",
      requireGps: true,
      requireNetwork: false,
      allowRemote: false,
      blockIfOutside: false,
      allowAbnormalReview: true,
      radiusMeters: 120,
    },
    regular_holiday: {
      label: "例假日",
      requireGps: true,
      requireNetwork: true,
      allowRemote: false,
      blockIfOutside: true,
      allowAbnormalReview: false,
      radiusMeters: 120,
    },
    national_holiday: {
      label: "國定假日",
      requireGps: true,
      requireNetwork: false,
      allowRemote: false,
      blockIfOutside: false,
      allowAbnormalReview: true,
      radiusMeters: 120,
    },
  },
  locationRules: defaultClockLocationRules,
  networkRules: defaultNetworkClockRules,
  employeePolicies: [
    {
      employeeNo: "E001",
      employeeName: "潘雨柔",
      policyMode: "fixed_site",
      primaryLocationRuleId: "branch-hq",
      remoteAllowed: false,
      radiusOverrideMeters: null,
      note: "預設總公司定點上班。",
    },
    {
      employeeNo: "E002",
      employeeName: "陳怡霖",
      policyMode: "fixed_site",
      primaryLocationRuleId: "branch-admin",
      remoteAllowed: false,
      radiusOverrideMeters: null,
      note: "行政辦公室定點上班。",
    },
  ],
  legalNotes: [
    "一般週期每 7 日應有 1 日例假、1 日休息日。",
    "四週彈性工時每二週內至少 2 日例假，每四週例假加休息日至少 8 日。",
    "例假日出勤須符合天災、事變或突發事件等法定例外，系統預設阻擋任意打卡。",
  ],
};

export function normalizeClockRuleSettings(value: unknown): ClockRuleSettings {
  if (!value || typeof value !== "object") return defaultClockRuleSettings;
  const settings = value as Partial<ClockRuleSettings>;

  return {
    ...defaultClockRuleSettings,
    ...settings,
    dayRules: {
      ...defaultClockRuleSettings.dayRules,
      ...(settings.dayRules ?? {}),
    },
    locationRules: Array.isArray(settings.locationRules) && settings.locationRules.length
      ? settings.locationRules
      : defaultClockLocationRules,
    networkRules: Array.isArray(settings.networkRules) && settings.networkRules.length
      ? settings.networkRules
      : defaultNetworkClockRules,
    employeePolicies: Array.isArray(settings.employeePolicies)
      ? settings.employeePolicies
      : defaultClockRuleSettings.employeePolicies,
  };
}
