"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ExternalLink,
  LocateFixed,
  LogIn,
  LogOut,
  MapPin,
  MonitorSmartphone,
  Navigation,
  ShieldCheck,
  Wifi,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  dayTypeLabels,
  defaultClockLocationRules,
  defaultClockRuleSettings,
  defaultNetworkClockRules,
  normalizeClockRuleSettings,
  policyModeLabels,
  weekdayLabels,
  type ClockLocationRule,
  type ClockRuleSettings,
  type NetworkClockRule,
  type RuleMethod,
} from "@/lib/attendance/clock-rule-settings";
import { useCurrentUser } from "@/lib/auth/use-current-user";
import { getGoogleMapsEmbedUrl, getGoogleMapsUrl } from "@/lib/maps/google-maps";

type PunchType = "clock_in" | "clock_out" | "out" | "return";
type ReviewStatus = "none" | "pending" | "approved" | "rejected";

type PunchRecord = {
  id: string;
  employeeId: string;
  punchedAt: string;
  type: PunchType;
  latitude: number | null;
  longitude: number | null;
  address: string;
  deviceInfo: string;
  wifiSsid: string;
  ipAddress: string;
  isAbnormal: boolean;
  abnormalReason: string;
  ruleName: string;
  passedRule: RuleMethod;
  distanceMeters: number | null;
  reviewStatus: ReviewStatus;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewNote?: string;
};

const punchTypeLabels: Record<PunchType, string> = {
  clock_in: "上班打卡",
  clock_out: "下班打卡",
  out: "外出打卡",
  return: "返回打卡",
};

const punchActions: Array<{
  type: PunchType;
  label: string;
  hint: string;
  icon: typeof LogIn;
  className: string;
}> = [
  {
    type: "clock_in",
    label: "上班打卡",
    hint: "08:00-08:30 或 08:30-09:00 到班",
    icon: LogIn,
    className: "bg-emerald-600 hover:bg-emerald-700",
  },
  {
    type: "clock_out",
    label: "下班打卡",
    hint: "結束今日班表",
    icon: LogOut,
    className: "bg-sky-600 hover:bg-sky-700",
  },
];

type LocationCaptureResult = {
  ok: boolean;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
};

function formatNow() {
  const now = new Date();
  return formatDateTime(now);
}

function formatDateTime(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function getWorkDate(value: string) {
  return value.slice(0, 10);
}

function getTodayText() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function getWeekdayKey(value: Date) {
  return ([
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const)[value.getDay()];
}

function getDeviceInfo() {
  if (typeof navigator === "undefined") return "Unknown device";
  const platform = navigator.platform || "Unknown platform";
  const userAgent = navigator.userAgent.includes("Chrome")
    ? "Chrome"
    : navigator.userAgent.includes("Safari")
      ? "Safari"
      : "Browser";
  return `${userAgent} / ${platform}`;
}

function getDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusMeters = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

function getNearestRule(lat: number, lng: number, rules: ClockLocationRule[]) {
  return rules
    .map((rule) => ({
      rule,
      distanceMeters: getDistanceMeters(lat, lng, rule.latitude, rule.longitude),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
}

function formatDistanceMeters(distance: number | null) {
  if (distance === null) return "未取得";
  if (distance >= 1000) return `${(distance / 1000).toFixed(2)} 公里`;
  return `${distance} 公尺`;
}

function getMapsUrl(lat: number | null, lng: number | null) {
  return getGoogleMapsUrl(lat, lng);
}

function isSecureLocationContext() {
  if (typeof window === "undefined") return true;
  return window.isSecureContext || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
}

function requestBrowserLocation() {
  return new Promise<GeolocationPosition>((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("此瀏覽器不支援定位"));
      return;
    }

    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0,
    });
  });
}

function parseRuleList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

type AttendancePunchRow = {
  id: string;
  user_id: string;
  punched_at: string;
  punch_type: PunchType;
  latitude: number | string | null;
  longitude: number | string | null;
  address: string | null;
  device_info: string | null;
  wifi_ssid: string | null;
  ip_address: string | null;
  is_abnormal: boolean;
  abnormal_reason: string | null;
  rule_name: string | null;
  passed_rule: RuleMethod | null;
  distance_meters: number | null;
  review_status: ReviewStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
};

function mapPunchRow(row: AttendancePunchRow): PunchRecord {
  return {
    id: row.id,
    employeeId: row.user_id,
    punchedAt: formatDateTime(row.punched_at),
    type: row.punch_type,
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
    address: row.address ?? "",
    deviceInfo: row.device_info ?? "",
    wifiSsid: row.wifi_ssid ?? "",
    ipAddress: row.ip_address ?? "",
    isAbnormal: row.is_abnormal,
    abnormalReason: row.abnormal_reason ?? "",
    ruleName: row.rule_name ?? "",
    passedRule: row.passed_rule ?? "送審",
    distanceMeters: row.distance_meters,
    reviewStatus: row.review_status,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at).toLocaleString("zh-TW", { hour12: false }) : undefined,
    reviewNote: row.review_note ?? undefined,
  };
}

async function loadPunchRecords() {
  const response = await fetch("/api/clock/punches?limit=200", { cache: "no-store" });
  const payload = await response.json() as { punches?: AttendancePunchRow[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "讀取打卡資料失敗。");
  return ((payload.punches ?? []) as AttendancePunchRow[]).map(mapPunchRow);
}

async function insertPunchRecord(record: PunchRecord) {
  const response = await fetch("/api/clock/punches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      punchType: record.type,
      latitude: record.latitude,
      longitude: record.longitude,
      address: record.address,
      deviceInfo: record.deviceInfo,
      wifiSsid: record.wifiSsid,
      ipAddress: record.ipAddress,
      isAbnormal: record.isAbnormal,
      abnormalReason: record.abnormalReason,
      ruleName: record.ruleName,
      passedRule: record.passedRule,
      distanceMeters: record.distanceMeters,
      reviewStatus: record.reviewStatus,
    }),
  });
  const payload = await response.json() as { punch?: AttendancePunchRow; error?: string };
  if (!response.ok || !payload.punch) throw new Error(payload.error ?? "打卡寫入失敗。");
  return mapPunchRow(payload.punch);
}

async function updatePunchReview(record: PunchRecord, reviewStatus: "approved" | "rejected") {
  const response = await fetch("/api/clock/punches", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      punchId: record.id,
      reviewStatus,
    }),
  });
  const payload = await response.json() as { punch?: AttendancePunchRow; error?: string };
  if (!response.ok || !payload.punch) throw new Error(payload.error ?? "異常打卡審核失敗。");
  return mapPunchRow(payload.punch);
}

async function loadClockRuleSettings() {
  const response = await fetch("/api/clock/rules", { cache: "no-store" });
  const payload = await response.json() as { settings?: ClockRuleSettings; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "讀取打卡規則失敗。");
  return normalizeClockRuleSettings(payload.settings);
}

function getLatestOpenStatus(records: PunchRecord[]) {
  const latest = records[0];
  if (!latest) return "尚未打卡";
  if (latest.type === "clock_in" || latest.type === "return") return "上班中";
  if (latest.type === "out") return "外出中";
  return "已下班";
}

function getActionDisabledReason(type: PunchType, records: PunchRecord[]) {
  const latest = records[0];
  if (!latest) return type === "clock_out" || type === "out" || type === "return" ? "請先上班打卡" : "";

  if (type === "clock_in" && latest.type !== "clock_out") return "尚未下班，不可重複上班打卡";
  if (type === "clock_out" && latest.type !== "clock_in" && latest.type !== "return") return "目前不在上班狀態";
  if (type === "out" && latest.type !== "clock_in" && latest.type !== "return") return "目前不在上班狀態，無法外出";
  if (type === "return" && latest.type !== "out") return "目前沒有外出紀錄";

  return "";
}

function getRecommendedPunchType(records: PunchRecord[]): PunchType {
  const latest = records[0];
  if (!latest || latest.type === "clock_out") return "clock_in";
  if (latest.type === "out") return "return";
  return "clock_out";
}

function getPunchStatusTone(status: string) {
  if (status === "上班中") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "外出中") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "已下班") return "border-slate-200 bg-slate-50 text-slate-700";
  return "border-orange-200 bg-orange-50 text-orange-800";
}

export default function ClockPage() {
  const currentUser = useCurrentUser();
  const [records, setRecords] = useState<PunchRecord[]>([]);
  const [clockRuleSettings, setClockRuleSettings] = useState<ClockRuleSettings>(defaultClockRuleSettings);
  const [locationRules, setLocationRules] = useState<ClockLocationRule[]>(defaultClockLocationRules);
  const [networkRules, setNetworkRules] = useState<NetworkClockRule[]>(defaultNetworkClockRules);
  const [latitude, setLatitude] = useState("25.0478");
  const [longitude, setLongitude] = useState("121.5170");
  const [address, setAddress] = useState("台北市中正區仁愛路一段 1 號");
  const [wifiSsid, setWifiSsid] = useState("SuiYue-HQ");
  const [ipAddress, setIpAddress] = useState("203.0.113.18");
  const [selectedRuleId, setSelectedRuleId] = useState(defaultClockLocationRules[0].id);
  const [locationStatus, setLocationStatus] = useState("可使用預設據點位置，或按下定位更新。");
  const [locationAccuracy, setLocationAccuracy] = useState<number | null>(null);
  const [locationCapturedAt, setLocationCapturedAt] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [selectedNetworkRuleId, setSelectedNetworkRuleId] = useState(defaultNetworkClockRules[0].id);
  const [punchMessage, setPunchMessage] = useState("");
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState("正在取得裝置資訊");
  const [currentTime, setCurrentTime] = useState(formatNow());
  const [isPunching, setIsPunching] = useState(false);

  const todayText = getTodayText();
  const isAuthenticated = Boolean(currentUser.id);
  const canReviewAbnormal = ["hr", "admin_director", "ceo"].includes(currentUser.role);

  useEffect(() => {
    if (!isAuthenticated) return;
    let isMounted = true;
    loadClockRuleSettings()
      .then((settings) => {
        if (!isMounted) return;
        const fixedLocationRules = settings.locationRules.filter((rule) => rule.type === "company_branch");
        const nextLocationRules = fixedLocationRules.length ? fixedLocationRules : defaultClockLocationRules;
        setClockRuleSettings(settings);
        setLocationRules(nextLocationRules);
        setNetworkRules(settings.networkRules);
        const firstRule = nextLocationRules[0] ?? defaultClockLocationRules[0];
        const firstNetworkRule = settings.networkRules[0] ?? defaultNetworkClockRules[0];
        setSelectedRuleId((current) => nextLocationRules.some((rule) => rule.id === current) ? current : firstRule.id);
        setSelectedNetworkRuleId((current) => settings.networkRules.some((rule) => rule.id === current) ? current : firstNetworkRule.id);
      })
      .catch((error) => {
        if (isMounted) setLocationStatus(error instanceof Error ? error.message : "打卡規則載入失敗，先使用預設規則。");
      });

    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setRecords([]);
      setPunchMessage("請先登入後再使用打卡功能。");
      return;
    }
    let isMounted = true;
    loadPunchRecords()
      .then((rows) => {
        if (isMounted) setRecords(rows);
      })
      .catch((error) => {
        if (isMounted) setPunchMessage(error instanceof Error ? error.message : "讀取 Supabase 打卡資料失敗。");
      });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    setDeviceInfo(getDeviceInfo());
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentTime(formatNow()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!canReviewAbnormal && showAllRecords) {
      setShowAllRecords(false);
    }
  }, [canReviewAbnormal, showAllRecords]);

  const personalRecords = useMemo(
    () => records.filter((record) => record.employeeId === currentUser.id),
    [currentUser.id, records],
  );
  const todayRecords = useMemo(
    () => personalRecords.filter((record) => getWorkDate(record.punchedAt) === todayText),
    [personalRecords, todayText],
  );
  const visibleRecords = useMemo(
    () => (showAllRecords && canReviewAbnormal ? records : personalRecords),
    [canReviewAbnormal, personalRecords, records, showAllRecords],
  );
  const currentAttendanceStatus = getLatestOpenStatus(todayRecords);
  const recommendedPunchType = getRecommendedPunchType(todayRecords);
  const recommendedAction =
    punchActions.find((action) => action.type === recommendedPunchType) ?? punchActions[0];
  const latestPunch = todayRecords[0];

  const todayWeekday = getWeekdayKey(new Date());
  const currentDayType = clockRuleSettings.regularHolidayWeekdays.includes(todayWeekday)
    ? "regular_holiday"
    : clockRuleSettings.restDayWeekdays.includes(todayWeekday)
      ? "rest_day"
      : "weekday";
  const currentDayRule = clockRuleSettings.dayRules[currentDayType];
  const employeePolicy = clockRuleSettings.employeePolicies.find(
    (policy) => policy.employeeName === currentUser.name || policy.employeeNo === currentUser.email.split("@")[0],
  );
  const employeeRemoteAllowed = false;
  const selectedRule = locationRules.find((rule) => rule.id === selectedRuleId) ?? locationRules[0] ?? defaultClockLocationRules[0];
  const effectiveRadiusMeters = employeePolicy?.radiusOverrideMeters ?? currentDayRule.radiusMeters ?? selectedRule.radiusMeters;
  const currentLat = Number(latitude);
  const currentLng = Number(longitude);
  const hasValidCurrentGps = Number.isFinite(currentLat) && Number.isFinite(currentLng);
  const nearestRule = hasValidCurrentGps ? getNearestRule(currentLat, currentLng, locationRules) : null;
  const selectedRuleDistance = hasValidCurrentGps
    ? getDistanceMeters(currentLat, currentLng, selectedRule.latitude, selectedRule.longitude)
    : null;
  const isOutsideSelectedRule =
    selectedRuleDistance !== null && selectedRuleDistance > effectiveRadiusMeters;
  const selectedNetworkRule =
    networkRules.find((rule) => rule.id === selectedNetworkRuleId) ?? networkRules[0] ?? defaultNetworkClockRules[0];
  const isWifiAllowed = selectedNetworkRule.allowedWifiSsids.includes(wifiSsid.trim());
  const isIpAllowed = selectedNetworkRule.allowedIpAddresses.includes(ipAddress.trim());
  const gpsPassed = !currentDayRule.requireGps || (hasValidCurrentGps && (!isOutsideSelectedRule || employeeRemoteAllowed));
  const networkPassed = !currentDayRule.requireNetwork || isWifiAllowed || isIpAllowed;
  const passedRule: RuleMethod = selectedNetworkRule.forceRestriction
    ? isWifiAllowed
      ? "Wi-Fi"
      : isIpAllowed
        ? "IP"
        : gpsPassed
          ? "送審"
          : "送審"
    : gpsPassed
      ? "GPS"
      : isWifiAllowed
        ? "Wi-Fi"
        : isIpAllowed
          ? "IP"
          : "送審";
  const ruleCheckItems = [
    {
      label: "位置範圍",
      passed: gpsPassed,
      detail: selectedRuleDistance !== null ? `${selectedRule.name} ${formatDistanceMeters(selectedRuleDistance)} / 限制 ${effectiveRadiusMeters} 公尺` : "尚未取得目前位置",
    },
    {
      label: "公司網路",
      passed: isWifiAllowed,
      detail: isWifiAllowed ? "目前連線符合公司設定" : "目前連線不在公司設定內",
    },
    {
      label: "上班環境",
      passed: isIpAllowed,
      detail: isIpAllowed ? "已確認為允許的上班環境" : "尚未確認上班環境",
    },
    {
      label: "主管確認",
      passed: currentDayRule.allowAbnormalReview && selectedNetworkRule.allowAbnormalReview,
      detail: currentDayRule.allowAbnormalReview && selectedNetworkRule.allowAbnormalReview ? "若位置不符仍可送出，交由主管或人資確認" : "此規則低於標準時會直接阻擋",
    },
    {
      label: "今日規則",
      passed: networkPassed && gpsPassed,
      detail: `${dayTypeLabels[currentDayType]} · ${employeePolicy ? policyModeLabels[employeePolicy.policyMode] : policyModeLabels[clockRuleSettings.defaultPolicyMode]}`,
    },
  ];
  const employeePunchStatusText = passedRule === "送審"
    ? "需要主管或人資確認"
    : "可正常打卡";
  const employeePunchStatusDetail = passedRule === "送審"
    ? "目前位置或上班環境需要確認；你仍可送出，系統會保留紀錄讓主管或人資處理。"
    : "目前位置與上班環境已確認，可以正常打卡。";
  const currentMapsUrl = getMapsUrl(hasValidCurrentGps ? currentLat : null, hasValidCurrentGps ? currentLng : null);
  const mapFocusLat = hasValidCurrentGps ? currentLat : selectedRule.latitude;
  const mapFocusLng = hasValidCurrentGps ? currentLng : selectedRule.longitude;
  const currentGoogleMapEmbedUrl = getGoogleMapsEmbedUrl(mapFocusLat, mapFocusLng, 17);
  const locationSummaryTone = !hasValidCurrentGps
    ? "border-amber-200 bg-amber-50 text-amber-900"
    : isOutsideSelectedRule
      ? "border-rose-200 bg-rose-50 text-rose-800"
      : "border-emerald-200 bg-emerald-50 text-emerald-800";

  async function captureCurrentLocation(options: { forPunch?: boolean } = {}): Promise<LocationCaptureResult> {
    if (!isSecureLocationContext()) {
      setLocationStatus("定位需要 HTTPS 才能啟用；若瀏覽器拒絕定位，打卡仍可送出但會送主管或人資確認。");
      return { ok: false };
    }

    setIsLocating(true);
    setLocationStatus(options.forPunch ? "打卡前正在取得目前定位..." : "正在取得目前定位...");
    try {
      const position = await requestBrowserLocation();
      const nextLat = position.coords.latitude;
      const nextLng = position.coords.longitude;
      const nextAccuracy = Math.round(position.coords.accuracy);
      const nearest = getNearestRule(nextLat, nextLng, locationRules);
      setLatitude(nextLat.toFixed(6));
      setLongitude(nextLng.toFixed(6));
      setLocationAccuracy(nextAccuracy);
      setLocationCapturedAt(formatNow());
      setLocationStatus(
        `已取得定位：距離 ${nearest.rule.name} 約 ${formatDistanceMeters(nearest.distanceMeters)}，定位精準度 ±${nextAccuracy} 公尺。`,
      );
      return { ok: true, latitude: nextLat, longitude: nextLng, accuracy: nextAccuracy };
    } catch {
      setLocationStatus("定位失敗或未允許定位；打卡仍可送出，但會標記為待主管或人資確認。");
      setLocationAccuracy(null);
      setLocationCapturedAt("");
      return { ok: false };
    } finally {
      setIsLocating(false);
    }
  }

  function updateCurrentLocation() {
    void captureCurrentLocation();
  }

  async function handlePunch(type: PunchType) {
    if (!isAuthenticated) {
      setPunchMessage("請先登入後再打卡。");
      return;
    }
    const disabledReason = getActionDisabledReason(type, todayRecords);
    if (disabledReason) {
      setPunchMessage(disabledReason);
      return;
    }

    const locationCapturedForPunch = await captureCurrentLocation({ forPunch: true });
    const lat = locationCapturedForPunch.latitude ?? Number(latitude);
    const lng = locationCapturedForPunch.longitude ?? Number(longitude);
    const hasValidGps = Number.isFinite(lat) && Number.isFinite(lng);
    const nearest = hasValidGps ? getNearestRule(lat, lng, locationRules) : null;
    const distanceToSelectedRule = hasValidGps
      ? getDistanceMeters(lat, lng, selectedRule.latitude, selectedRule.longitude)
      : null;
    const outsideSelectedRule =
      distanceToSelectedRule !== null && distanceToSelectedRule > effectiveRadiusMeters;
    const networkRule = selectedNetworkRule;
    const wifiPassed = networkRule.allowedWifiSsids.includes(wifiSsid.trim());
    const ipPassed = networkRule.allowedIpAddresses.includes(ipAddress.trim());
    const gpsRulePassed = !currentDayRule.requireGps || (hasValidGps && (!outsideSelectedRule || employeeRemoteAllowed));
    const networkPassedForPunch = wifiPassed || ipPassed;
    const nextPassedRule: RuleMethod = networkRule.forceRestriction
      ? wifiPassed
        ? "Wi-Fi"
        : ipPassed
          ? "IP"
          : "送審"
      : gpsRulePassed
        ? "GPS"
        : wifiPassed
          ? "Wi-Fi"
          : ipPassed
            ? "IP"
            : "送審";
    const isNetworkBlocked =
      (networkRule.forceRestriction || currentDayRule.requireNetwork) && !networkPassedForPunch;
    const isGpsBlocked =
      currentDayRule.blockIfOutside && outsideSelectedRule && !employeeRemoteAllowed;
    const abnormalReasons = [
      !locationCapturedForPunch.ok ? "未取得瀏覽器即時定位" : "",
      !hasValidGps ? "未取得目前位置" : "",
      outsideSelectedRule && !employeeRemoteAllowed
        ? `不在 ${selectedRule.name} ${effectiveRadiusMeters} 公尺可打卡範圍內，需主管或人資確認`
        : "",
      networkRule.forceRestriction && !wifiPassed ? "目前連線環境不符合此據點設定" : "",
      networkRule.forceRestriction && !ipPassed ? "目前上班環境尚未被系統確認" : "",
      isNetworkBlocked && !networkRule.allowAbnormalReview ? "此據點需要在指定環境內才能打卡" : "",
      currentDayType === "regular_holiday" ? "今日為例假日規則，需確認是否具法定例外原因" : "",
      !address.trim() ? "地址未填寫" : "",
      !ipAddress.trim() ? "上班環境尚未確認" : "",
    ].filter(Boolean);

    if ((isNetworkBlocked && !networkRule.allowAbnormalReview) || isGpsBlocked) {
      setPunchMessage("目前不符合此日別或員工政策的打卡規則，請回到指定地點或改走主管/人資確認流程。");
      return;
    }

    const nextRecord: PunchRecord = {
      id: `punch-${Date.now()}`,
      employeeId: currentUser.id,
      punchedAt: formatNow(),
      type,
      latitude: hasValidGps ? lat : null,
      longitude: hasValidGps ? lng : null,
      address: address.trim() || "未取得地址",
      deviceInfo,
      wifiSsid: wifiSsid.trim() || "未取得 Wi-Fi",
      ipAddress: ipAddress.trim() || "未取得 IP",
      isAbnormal: nextPassedRule === "送審" || abnormalReasons.length > 0,
      abnormalReason: abnormalReasons.join("；"),
      ruleName: nearest?.rule.name ?? selectedRule.name,
      passedRule: nextPassedRule,
      distanceMeters: distanceToSelectedRule,
      reviewStatus: nextPassedRule === "送審" || abnormalReasons.length > 0 ? "pending" : "none",
    };

    setIsPunching(true);
    try {
      const savedRecord = await insertPunchRecord(nextRecord);
      setRecords((current) => [savedRecord, ...current]);
      setPunchMessage(
        savedRecord.isAbnormal
          ? "打卡已送出，但需要主管或人資確認後才會列為正常出勤。"
          : "打卡成功，已列入今日出勤紀錄。",
      );
    } catch (error) {
      setPunchMessage(error instanceof Error ? error.message : "打卡寫入 Supabase 失敗。");
    } finally {
      setIsPunching(false);
    }
  }

  async function reviewRecord(recordId: string, reviewStatus: "approved" | "rejected") {
    if (!canReviewAbnormal) {
      setPunchMessage("只有人資、行政部門主任或執行長可以審核異常打卡。");
      return;
    }

    const target = records.find((record) => record.id === recordId);
    if (!target) return;
    try {
      const savedRecord = await updatePunchReview(target, reviewStatus);
      setRecords((current) => current.map((record) => (record.id === recordId ? savedRecord : record)));
    } catch (error) {
      setPunchMessage(error instanceof Error ? error.message : "異常打卡審核寫入 Supabase 失敗。");
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-4 xl:grid-cols-[1.05fr_.95fr]">
        <Card className="overflow-hidden rounded-lg border-[#ead8c2]">
          <CardContent className="p-0">
            <div className="bg-slate-950 p-5 text-white sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-bold tracking-[0.14em] text-[#f6c177]">EMPLOYEE CLOCK</p>
                  <h1 className="mt-2 text-2xl font-black">我要打卡</h1>
                  <p className="mt-2 text-sm text-slate-300">
                    {isAuthenticated ? `${currentUser.name} · ${todayText}` : "請先登入後再使用打卡功能"}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-3xl font-black tabular-nums">{currentTime.slice(11)}</div>
                  <div className="mt-1 text-xs text-slate-400">{currentTime.slice(0, 10)}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
                <div className={`rounded-lg border px-4 py-3 ${getPunchStatusTone(currentAttendanceStatus)}`}>
                  <div className="text-xs font-black tracking-[0.12em]">目前狀態</div>
                  <div className="mt-1 text-2xl font-black">{currentAttendanceStatus}</div>
                  <div className="mt-1 text-sm opacity-80">
                    {latestPunch ? `最近一次：${punchTypeLabels[latestPunch.type]} ${latestPunch.punchedAt.slice(11)}` : "今日尚未打卡"}
                  </div>
                </div>
                <Button
                  className={`h-16 min-w-[180px] text-base font-black ${recommendedAction.className}`}
                  onClick={() => handlePunch(recommendedAction.type)}
                  disabled={!isAuthenticated || isPunching || isLocating || Boolean(getActionDisabledReason(recommendedAction.type, todayRecords))}
                  title={getActionDisabledReason(recommendedAction.type, todayRecords) || recommendedAction.hint}
                >
                  <recommendedAction.icon className="h-5 w-5" />
                  {isLocating ? "定位中..." : isPunching ? "寫入中..." : recommendedAction.label}
                </Button>
              </div>
            </div>

            <div className="grid gap-3 p-4 sm:grid-cols-3">
              {[
                ["今日打卡", `${todayRecords.length} 筆`, "本人今日紀錄"],
                ["待確認", `${todayRecords.filter((record) => record.reviewStatus === "pending").length} 筆`, "主管或人資處理中"],
                ["目前檢查", employeePunchStatusText, employeePunchStatusDetail],
              ].map(([label, value, detail]) => (
                <div key={label} className="rounded-lg bg-[#fffaf4] px-3 py-3">
                  <div className="text-xs font-semibold text-slate-500">{label}</div>
                  <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
                  <div className="mt-1 text-xs text-slate-500">{detail}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-[#ead8c2]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" />
              打卡前確認
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ruleCheckItems.map((item) => (
              <div key={item.label} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                <div>
                  <div className="font-bold text-slate-950">{item.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{item.detail}</div>
                </div>
                <Badge className={item.passed ? "bg-emerald-600" : "bg-amber-600"}>
                  {item.passed ? "通過" : "未通過"}
                </Badge>
              </div>
            ))}
            <div
              className={`rounded-lg p-3 text-sm font-semibold ${
                passedRule === "送審" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {employeePunchStatusDetail}
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-3 sm:grid-cols-3">
        {punchActions
          .filter((action) => action.type !== recommendedAction.type)
          .map((action) => {
            const disabledReason = !isAuthenticated ? "請先登入後再打卡" : getActionDisabledReason(action.type, todayRecords);

            return (
              <Button
                key={action.type}
                variant="outline"
                className="h-auto justify-start rounded-lg border-[#ead8c2] bg-white p-4 text-left"
                onClick={() => handlePunch(action.type)}
                disabled={Boolean(disabledReason) || isPunching || isLocating}
                title={disabledReason || action.hint}
              >
                <action.icon className="h-5 w-5 text-[#b45309]" />
                <span>
                  <span className="block font-black">{action.label}</span>
                  <span className="block text-xs font-normal text-slate-500">{disabledReason || action.hint}</span>
                </span>
              </Button>
            );
          })}
      </section>

      {punchMessage ? (
        <div
          className={`rounded-lg p-3 text-sm font-semibold ${
            punchMessage.includes("成功") ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
          }`}
        >
          {punchMessage}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[.9fr_1.1fr]">
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LocateFixed className="h-5 w-5 text-primary" />
              打卡位置確認
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold">
                上班地點
                <select
                  value={selectedRuleId}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                  onChange={(event) => {
                    const nextRule = locationRules.find((rule) => rule.id === event.target.value);
                    setSelectedRuleId(event.target.value);
                    const nextNetworkRule = networkRules.find((rule) => rule.branchName === nextRule?.name);
                    if (nextNetworkRule) {
                      setSelectedNetworkRuleId(nextNetworkRule.id);
                      setWifiSsid(nextNetworkRule.allowedWifiSsids[0] ?? "");
                      setIpAddress(nextNetworkRule.allowedIpAddresses[0] ?? "");
                    }
                    if (nextRule) {
                      setLatitude(String(nextRule.latitude));
                      setLongitude(String(nextRule.longitude));
                      setAddress(nextRule.address);
                    }
                  }}
                >
                  {locationRules.map((rule) => (
                    <option key={rule.id} value={rule.id}>
                      {rule.name} / 公司據點
                    </option>
                  ))}
                </select>
              </label>
              <div className="rounded-lg border p-3">
                <div className="text-xs text-muted-foreground">可打卡範圍</div>
                <div className="mt-1 text-xl font-black">{effectiveRadiusMeters} 公尺</div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border bg-[#fffaf4] p-3">
                <div className="text-xs font-bold text-slate-500">今日打卡規則</div>
                <div className="mt-1 text-sm font-black text-slate-950">{dayTypeLabels[currentDayType]}</div>
                <div className="mt-1 text-xs text-slate-500">{weekdayLabels[todayWeekday]} · {clockRuleSettings.mode === "four_week_flexible" ? "四週變形工時" : "一般週期"}</div>
              </div>
              <div className="rounded-lg border bg-[#fffaf4] p-3">
                <div className="text-xs font-bold text-slate-500">員工政策</div>
                <div className="mt-1 text-sm font-black text-slate-950">
                  {employeePolicy ? policyModeLabels[employeePolicy.policyMode] : policyModeLabels[clockRuleSettings.defaultPolicyMode]}
                </div>
                <div className="mt-1 text-xs text-slate-500">需在指定範圍內</div>
              </div>
              <div className="rounded-lg border bg-[#fffaf4] p-3">
                <div className="text-xs font-bold text-slate-500">例休設定</div>
                <div className="mt-1 text-xs font-semibold text-slate-700">
                  例假：{clockRuleSettings.regularHolidayWeekdays.map((day) => weekdayLabels[day]).join("、")}
                </div>
                <div className="mt-1 text-xs font-semibold text-slate-700">
                  休息：{clockRuleSettings.restDayWeekdays.map((day) => weekdayLabels[day]).join("、")}
                </div>
              </div>
            </div>

            <div className={`rounded-lg border p-4 ${locationSummaryTone}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-black">
                    <Navigation className="h-4 w-4" />
                    員工目前定位
                  </div>
                  <div className="mt-2 text-2xl font-black">
                    {hasValidCurrentGps ? `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}` : "尚未取得定位"}
                  </div>
                  <div className="mt-1 text-sm font-semibold">
                    {selectedRuleDistance !== null
                      ? `距離 ${selectedRule.name} ${formatDistanceMeters(selectedRuleDistance)}`
                      : "請按下更新目前位置，或直接打卡時由系統自動取得定位。"}
                  </div>
                </div>
                {currentMapsUrl ? (
                  <Button asChild variant="outline" className="bg-white/70">
                    <a href={currentMapsUrl}>
                      <ExternalLink className="h-4 w-4" />
                      Google Maps
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 text-xs font-bold sm:grid-cols-3">
                <div className="rounded-md bg-white/65 p-2">
                  <div className="text-slate-500">定位時間</div>
                  <div className="mt-1 text-slate-950">{locationCapturedAt || "尚未更新"}</div>
                </div>
                <div className="rounded-md bg-white/65 p-2">
                  <div className="text-slate-500">定位精準度</div>
                  <div className="mt-1 text-slate-950">{locationAccuracy !== null ? `±${locationAccuracy} 公尺` : "未取得"}</div>
                </div>
                <div className="rounded-md bg-white/65 p-2">
                  <div className="text-slate-500">範圍判斷</div>
                  <div className="mt-1 text-slate-950">
                    {hasValidCurrentGps ? (isOutsideSelectedRule ? "超出範圍，送審" : "在可打卡範圍內") : "尚未判斷"}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {canReviewAbnormal ? (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    GPS 緯度
                    <Input value={latitude} onChange={(event) => setLatitude(event.target.value)} />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    GPS 經度
                    <Input value={longitude} onChange={(event) => setLongitude(event.target.value)} />
                  </label>
                </>
              ) : (
                <div className="rounded-lg border bg-slate-50 p-3 md:col-span-2">
                  <div className="text-xs font-bold text-slate-500">目前位置</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {selectedRuleDistance !== null
                      ? `距離 ${selectedRule.name} 約 ${formatDistanceMeters(selectedRuleDistance)}`
                      : "尚未取得目前位置"}
                  </div>
                </div>
              )}
              <label className="grid gap-1.5 text-sm font-semibold md:col-span-2">
                所在地址
                <Input value={address} onChange={(event) => setAddress(event.target.value)} />
              </label>
              {canReviewAbnormal ? (
                <>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    IP 位址
                    <Input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} />
                  </label>
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Wi-Fi 名稱
                    <Input value={wifiSsid} onChange={(event) => setWifiSsid(event.target.value)} />
                  </label>
                  <div className="grid gap-1.5 text-sm font-semibold">
                    裝置資訊
                    <div className="flex h-10 items-center gap-2 rounded-md border bg-muted/60 px-3 text-sm text-muted-foreground">
                      <MonitorSmartphone className="h-4 w-4" />
                      {deviceInfo}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border bg-slate-50 p-3 md:col-span-2">
                  <div className="text-xs font-bold text-slate-500">連線環境</div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {isWifiAllowed || isIpAllowed ? "已確認為可打卡環境" : "尚未確認，必要時會送主管或人資確認"}
                  </div>
                </div>
              )}
            </div>

            <Button variant="outline" onClick={updateCurrentLocation} disabled={isLocating}>
              <MapPin className="h-4 w-4" />
              {isLocating ? "正在定位..." : "更新目前位置"}
            </Button>

            <div className="rounded-lg bg-muted/70 p-3 text-sm text-muted-foreground">
              {locationStatus}
            </div>

            <div
              className={`rounded-lg p-3 text-sm font-semibold ${
                passedRule === "送審" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {employeePunchStatusDetail}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              打卡位置地圖
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-lg border bg-slate-100">
              {currentGoogleMapEmbedUrl ? (
                <iframe
                  title="Google Maps 打卡位置"
                  src={currentGoogleMapEmbedUrl}
                  className="h-72 w-full"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
              ) : (
                <div className="flex h-72 items-center justify-center text-sm font-semibold text-slate-500">
                  尚未取得可顯示於 Google Maps 的座標
                </div>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">今日打卡筆數</div>
                <div className="mt-2 text-2xl font-black">{todayRecords.length}</div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">待確認筆數</div>
                <div className="mt-2 text-2xl font-black text-rose-600">
                  {todayRecords.filter((record) => record.isAbnormal).length}
                </div>
              </div>
              <div className="rounded-lg border p-4">
                <div className="text-sm text-muted-foreground">最近地點</div>
                <div className="mt-2 text-sm font-bold">
                  {nearestRule ? `${nearestRule.rule.name} · ${formatDistanceMeters(nearestRule.distanceMeters)}` : "未取得"}
                </div>
              </div>
            </div>
            <div className="rounded-lg border bg-[#fffaf4] p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <ShieldCheck className="h-4 w-4 text-primary" />
                本次打卡會記錄的位置
              </div>
              <div className="grid gap-3 text-sm md:grid-cols-[1fr_auto] md:items-center">
                <div className="space-y-1 font-semibold text-slate-700">
                  <div>地址：{address || "未填寫"}</div>
                  <div>座標：{hasValidCurrentGps ? `${currentLat.toFixed(6)}, ${currentLng.toFixed(6)}` : "未取得定位"}</div>
                  <div>距離：{selectedRuleDistance !== null ? `${selectedRule.name} ${formatDistanceMeters(selectedRuleDistance)}` : "尚未計算"}</div>
                </div>
                {currentMapsUrl ? (
                  <Button asChild variant="outline">
                    <a href={currentMapsUrl}>
                      <ExternalLink className="h-4 w-4" />
                      在 Google Maps 開啟
                    </a>
                  </Button>
                ) : null}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-black text-slate-950">
                <MapPin className="h-4 w-4 text-primary" />
                公司可打卡據點
              </div>
              <div className="grid gap-2">
                {locationRules.map((rule) => (
                  <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#fffaf4] px-3 py-2 text-sm">
                    <div>
                      <div className="font-bold text-slate-900">{rule.name}</div>
                      <div className="text-xs text-slate-500">{rule.latitude.toFixed(6)}, {rule.longitude.toFixed(6)} · 半徑 {rule.radiusMeters} 公尺</div>
                    </div>
                    <Button asChild size="sm" variant="outline">
                      <a href={getMapsUrl(rule.latitude, rule.longitude)}>
                        <ExternalLink className="h-4 w-4" />
                        Google Maps
                      </a>
                    </Button>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-lg border p-4">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold">
                <Wifi className="h-4 w-4 text-primary" />
                {canReviewAbnormal ? "打卡規則檢核" : "打卡提醒"}
              </div>
              {canReviewAbnormal ? (
                <div className="text-sm leading-6 text-muted-foreground">
                  目前規則判斷：GPS {isOutsideSelectedRule ? "未通過" : "通過"}，
                  Wi-Fi {isWifiAllowed ? "通過" : "未通過"}，
                  IP {isIpAllowed ? "通過" : "未通過"}。打卡紀錄會標示實際通過哪一種規則。
                </div>
              ) : (
                <div className="text-sm leading-6 text-muted-foreground">
                  請確認你人在正確的上班地點。如果系統判斷需要確認，仍可先送出打卡，主管或人資會依紀錄處理。
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>

      {canReviewAbnormal ? (
        <Card className="rounded-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wifi className="h-5 w-5 text-primary" />
              Wi-Fi / IP 打卡規則設定
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              此區只開放人資、行政部門主任與執行長維護；員工端只會看到檢核結果，不會看到規則編輯器。
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 xl:grid-cols-3">
            {networkRules.map((rule) => (
              <div key={rule.id} className="rounded-lg border p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div className="font-black">{rule.branchName}</div>
                  <Badge variant={rule.forceRestriction ? "default" : "secondary"}>
                    {rule.forceRestriction ? "強制限制" : "彈性限制"}
                  </Badge>
                </div>
                <label className="grid gap-1.5 text-sm font-semibold">
                  允許打卡的 Wi-Fi 名稱
                  <Input
                    value={rule.allowedWifiSsids.join(", ")}
                    onChange={(event) =>
                      setNetworkRules((current) =>
                        current.map((item) =>
                          item.id === rule.id
                            ? { ...item, allowedWifiSsids: parseRuleList(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <label className="mt-3 grid gap-1.5 text-sm font-semibold">
                  允許打卡的 IP 位址
                  <Input
                    value={rule.allowedIpAddresses.join(", ")}
                    onChange={(event) =>
                      setNetworkRules((current) =>
                        current.map((item) =>
                          item.id === rule.id
                            ? { ...item, allowedIpAddresses: parseRuleList(event.target.value) }
                            : item,
                        ),
                      )
                    }
                  />
                </label>
                <div className="mt-4 grid gap-2 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.forceRestriction}
                      onChange={(event) =>
                        setNetworkRules((current) =>
                          current.map((item) =>
                            item.id === rule.id ? { ...item, forceRestriction: event.target.checked } : item,
                          ),
                        )
                      }
                    />
                    是否強制限制
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rule.allowAbnormalReview}
                      onChange={(event) =>
                        setNetworkRules((current) =>
                          current.map((item) =>
                            item.id === rule.id
                              ? { ...item, allowAbnormalReview: event.target.checked }
                              : item,
                          ),
                        )
                      }
                    />
                    是否允許異常打卡送審
                  </label>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="rounded-lg">
        <CardHeader>
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <CardTitle>打卡紀錄</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                一般員工只顯示自己的打卡時間、地點與處理狀態；人資、行政部門主任、執行長可查看完整檢核資料。
              </p>
            </div>
            {canReviewAbnormal ? (
              <Button variant="outline" onClick={() => setShowAllRecords((current) => !current)}>
                {showAllRecords ? "只看我的紀錄" : "查看公司紀錄"}
              </Button>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mobile-card-list">
            {visibleRecords.map((record) => (
              <article key={record.id} className="mobile-record-card space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-slate-950">{punchTypeLabels[record.type]}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{record.punchedAt}</p>
                  </div>
                  {record.isAbnormal ? (
                    <Badge className="bg-rose-600">
                      <AlertTriangle className="mr-1 h-3 w-3" />
                      待確認
                    </Badge>
                  ) : (
                    <Badge className="bg-emerald-600">正常</Badge>
                  )}
                </div>

                <div className="rounded-lg bg-[#fffaf4] p-3 text-sm font-semibold text-slate-700">
                  {record.abnormalReason || "已完成"}
                </div>

                <div className="grid gap-2">
                  {canReviewAbnormal ? (
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">員工</span>
                      <span className="mobile-card-value">{record.employeeId}</span>
                    </div>
                  ) : null}
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">地點</span>
                    <span className="mobile-card-value">{record.address}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">定位</span>
                    <span className="mobile-card-value">
                      {record.latitude !== null && record.longitude !== null
                        ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}`
                        : "未取得"}
                    </span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">距離</span>
                    <span className="mobile-card-value">{formatDistanceMeters(record.distanceMeters)}</span>
                  </div>
                  {canReviewAbnormal ? (
                    <>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">檢核規則</span>
                        <span className="mobile-card-value">{record.passedRule}</span>
                      </div>
                    </>
                  ) : null}
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">審核狀態</span>
                    <span className="mobile-card-value">
                      {record.reviewStatus === "approved" ? "已核准" : record.reviewStatus === "rejected" ? "已退回" : record.reviewStatus === "pending" ? "待審核" : "免審核"}
                    </span>
                  </div>
                </div>

                {record.reviewStatus === "pending" ? (
                  <div className="grid grid-cols-2 gap-2">
                    <Button size="sm" variant="outline" onClick={() => reviewRecord(record.id, "approved")} disabled={!canReviewAbnormal}>
                      核准
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => reviewRecord(record.id, "rejected")} disabled={!canReviewAbnormal}>
                      退回
                    </Button>
                  </div>
                ) : record.reviewedBy ? (
                  <p className="text-xs font-semibold text-slate-500">{record.reviewedBy} · {record.reviewedAt}</p>
                ) : null}
                {getMapsUrl(record.latitude, record.longitude) ? (
                  <Button asChild size="sm" variant="outline" className="w-full">
                    <a href={getMapsUrl(record.latitude, record.longitude)}>
                      <ExternalLink className="h-4 w-4" />
                      查看打卡位置
                    </a>
                  </Button>
                ) : null}
              </article>
            ))}
            {visibleRecords.length === 0 ? (
              <div className="mobile-record-card p-6 text-center text-sm font-semibold text-slate-500">目前沒有打卡紀錄</div>
            ) : null}
          </div>

          <div className="desktop-data-table overflow-hidden rounded-lg border">
            <div className="overflow-x-auto">
              <table className={`w-full text-left text-sm ${canReviewAbnormal ? "min-w-[1120px]" : "min-w-[720px]"}`}>
                <thead className="bg-muted/70 text-xs text-muted-foreground">
                  <tr>
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">員工 ID</th> : null}
                    <th className="px-4 py-3 font-bold">打卡時間</th>
                    <th className="px-4 py-3 font-bold">打卡類型</th>
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">GPS 經緯度</th> : null}
                    <th className="px-4 py-3 font-bold">地點</th>
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">裝置資訊</th> : null}
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">Wi-Fi 名稱</th> : null}
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">IP 位址</th> : null}
                    {canReviewAbnormal ? <th className="px-4 py-3 font-bold">通過哪一種規則</th> : null}
                    <th className="px-4 py-3 font-bold">狀態</th>
                    <th className="px-4 py-3 font-bold">說明</th>
                    <th className="px-4 py-3 font-bold">處理</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visibleRecords.map((record) => (
                    <tr key={record.id} className="bg-card hover:bg-muted/40">
                      {canReviewAbnormal ? <td className="px-4 py-3 font-semibold">{record.employeeId}</td> : null}
                      <td className="px-4 py-3">{record.punchedAt}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">{punchTypeLabels[record.type]}</Badge>
                      </td>
                      {canReviewAbnormal ? (
                        <td className="px-4 py-3">
                        {record.latitude !== null && record.longitude !== null
                          ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}`
                          : "未取得"}
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        <div className="font-semibold">{record.address}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {record.latitude !== null && record.longitude !== null
                            ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}`
                            : "未取得定位"}
                          {record.distanceMeters !== null ? ` · ${formatDistanceMeters(record.distanceMeters)}` : ""}
                        </div>
                        {getMapsUrl(record.latitude, record.longitude) ? (
                          <a
                            className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-primary underline-offset-4 hover:underline"
                            href={getMapsUrl(record.latitude, record.longitude)}
                          >
                            <ExternalLink className="h-3 w-3" />
                            查看地圖
                          </a>
                        ) : null}
                      </td>
                      {canReviewAbnormal ? <td className="px-4 py-3">{record.deviceInfo}</td> : null}
                      {canReviewAbnormal ? <td className="px-4 py-3">{record.wifiSsid}</td> : null}
                      {canReviewAbnormal ? <td className="px-4 py-3">{record.ipAddress}</td> : null}
                      {canReviewAbnormal ? (
                        <td className="px-4 py-3">
                          <div className="font-semibold">{record.passedRule}</div>
                          <div className="text-xs text-muted-foreground">
                            {record.ruleName} / {record.distanceMeters !== null ? `${record.distanceMeters} 公尺` : "未計算"}
                          </div>
                        </td>
                      ) : null}
                      <td className="px-4 py-3">
                        {record.isAbnormal ? (
                          <Badge className="bg-rose-600">
                            <AlertTriangle className="mr-1 h-3 w-3" />
                            待確認
                          </Badge>
                        ) : (
                          <Badge className="bg-emerald-600">正常</Badge>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {record.abnormalReason || "已完成"}
                      </td>
                      <td className="px-4 py-3">
                        {record.reviewStatus === "pending" ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => reviewRecord(record.id, "approved")} disabled={!canReviewAbnormal}>
                              核准
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => reviewRecord(record.id, "rejected")} disabled={!canReviewAbnormal}>
                              退回
                            </Button>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Badge variant="secondary">
                              {record.reviewStatus === "approved"
                                ? "已核准"
                                : record.reviewStatus === "rejected"
                                  ? "已退回"
                                  : "免審核"}
                            </Badge>
                            {record.reviewedBy ? (
                              <div className="text-xs text-muted-foreground">
                                {record.reviewedBy} · {record.reviewedAt}
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {visibleRecords.length === 0 ? (
                    <tr>
                      <td className="px-4 py-8 text-center text-muted-foreground" colSpan={canReviewAbnormal ? 12 : 6}>
                        目前沒有打卡紀錄
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
