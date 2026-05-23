"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Car,
  CheckCircle2,
  Clock3,
  Crosshair,
  ExternalLink,
  MapPin,
  Plus,
  RefreshCw,
  Route,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { getGoogleMapsUrl } from "@/lib/maps/google-maps";

type ServiceStatus = "scheduled" | "completed" | "cancelled" | "substitute";

type HomecareSchedule = {
  id: string;
  caregiver: string;
  client: string;
  address: string;
  district: string;
  startTime: string;
  endTime: string;
  serviceItems: string[];
  travelMinutes: number;
  crossDistrict: boolean;
  gpsLat: number;
  gpsLng: number;
  gpsRadiusMeters: number;
  status: ServiceStatus;
  substitute?: string;
  cancelReason?: string;
};

type HomecareForm = {
  caregiver: string;
  client: string;
  address: string;
  district: string;
  startTime: string;
  endTime: string;
  serviceItems: string;
  travelMinutes: string;
  crossDistrict: boolean;
  gpsLat: string;
  gpsLng: string;
  gpsRadiusMeters: string;
};

const caregivers = ["林佳蓉", "陳柏安", "王怡君", "黃志明", "李雅婷", "張育誠"];
const substituteCaregivers = ["周孟潔", "楊承恩", "許庭瑋"];
const serviceCatalog = ["身體清潔", "備餐", "陪同就醫", "家務協助", "復能陪伴", "安全巡視", "購物代辦"];

const initialSchedules: HomecareSchedule[] = [
  {
    id: "HC-20260518-001",
    caregiver: "林佳蓉",
    client: "吳阿嬤",
    address: "台北市大安區和平東路二段 96 巷 5 號",
    district: "大安區",
    startTime: "2026-05-18T08:30",
    endTime: "2026-05-18T10:30",
    serviceItems: ["身體清潔", "備餐", "安全巡視"],
    travelMinutes: 18,
    crossDistrict: false,
    gpsLat: 25.026,
    gpsLng: 121.543,
    gpsRadiusMeters: 120,
    status: "scheduled",
  },
  {
    id: "HC-20260518-002",
    caregiver: "陳柏安",
    client: "林先生",
    address: "新北市中和區景平路 260 號",
    district: "中和區",
    startTime: "2026-05-18T09:00",
    endTime: "2026-05-18T12:00",
    serviceItems: ["陪同就醫", "交通協助"],
    travelMinutes: 35,
    crossDistrict: true,
    gpsLat: 24.993,
    gpsLng: 121.515,
    gpsRadiusMeters: 180,
    status: "substitute",
    substitute: "周孟潔",
  },
  {
    id: "HC-20260518-003",
    caregiver: "王怡君",
    client: "張阿公",
    address: "台北市信義區松仁路 100 號",
    district: "信義區",
    startTime: "2026-05-18T13:30",
    endTime: "2026-05-18T15:30",
    serviceItems: ["家務協助", "購物代辦"],
    travelMinutes: 22,
    crossDistrict: false,
    gpsLat: 25.034,
    gpsLng: 121.568,
    gpsRadiusMeters: 100,
    status: "completed",
  },
  {
    id: "HC-20260518-004",
    caregiver: "黃志明",
    client: "鄭小姐",
    address: "台北市文山區木柵路三段 77 號",
    district: "文山區",
    startTime: "2026-05-18T16:00",
    endTime: "2026-05-18T18:00",
    serviceItems: ["復能陪伴", "安全巡視"],
    travelMinutes: 42,
    crossDistrict: true,
    gpsLat: 24.988,
    gpsLng: 121.567,
    gpsRadiusMeters: 150,
    status: "scheduled",
  },
  {
    id: "HC-20260518-005",
    caregiver: "李雅婷",
    client: "曾阿嬤",
    address: "台北市萬華區康定路 188 號",
    district: "萬華區",
    startTime: "2026-05-18T10:00",
    endTime: "2026-05-18T11:30",
    serviceItems: ["備餐", "家務協助"],
    travelMinutes: 28,
    crossDistrict: false,
    gpsLat: 25.037,
    gpsLng: 121.502,
    gpsRadiusMeters: 120,
    status: "cancelled",
    cancelReason: "個案臨時住院",
  },
];

const statusStyles: Record<ServiceStatus, string> = {
  scheduled: "border-sky-200 bg-sky-50 text-sky-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  cancelled: "border-rose-200 bg-rose-50 text-rose-700",
  substitute: "border-amber-200 bg-amber-50 text-amber-700",
};

const statusLabels: Record<ServiceStatus, string> = {
  scheduled: "已排班",
  completed: "已完成",
  cancelled: "個案取消",
  substitute: "臨時代班",
};

const defaultForm: HomecareForm = {
  caregiver: caregivers[0],
  client: "",
  address: "",
  district: "大安區",
  startTime: "2026-05-18T09:00",
  endTime: "2026-05-18T11:00",
  serviceItems: "身體清潔、備餐",
  travelMinutes: "20",
  crossDistrict: false,
  gpsLat: "25.033",
  gpsLng: "121.545",
  gpsRadiusMeters: "120",
};

function serviceHours(schedule: Pick<HomecareSchedule, "startTime" | "endTime" | "status">) {
  if (schedule.status === "cancelled") return 0;
  const diff = new Date(schedule.endTime).getTime() - new Date(schedule.startTime).getTime();
  return Math.max(diff / 60 / 60 / 1000, 0);
}

function formatTimeRange(startTime: string, endTime: string) {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const date = start.toLocaleDateString("zh-TW", { month: "2-digit", day: "2-digit", weekday: "short" });
  const startLabel = start.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  const endLabel = end.toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${startLabel}-${endLabel}`;
}

function mapPosition(lat: number, lng: number) {
  const minLat = 24.98;
  const maxLat = 25.04;
  const minLng = 121.49;
  const maxLng = 121.58;
  return {
    left: `${Math.min(Math.max(((lng - minLng) / (maxLng - minLng)) * 100, 8), 92)}%`,
    top: `${Math.min(Math.max((1 - (lat - minLat) / (maxLat - minLat)) * 100, 10), 90)}%`,
  };
}

export default function HomecareSchedulesPage() {
  const [schedules, setSchedules] = useState<HomecareSchedule[]>(initialSchedules);
  const [form, setForm] = useState<HomecareForm>(defaultForm);
  const [message, setMessage] = useState("建立居服排班後，服務地址與 GPS 半徑會同步帶入打卡規則。");
  const [error, setError] = useState("");

  const stats = useMemo(() => {
    const activeSchedules = schedules.filter((schedule) => schedule.status !== "cancelled");
    const totalHours = schedules.reduce((sum, schedule) => sum + serviceHours(schedule), 0);
    const caregiverHours = caregivers.map((caregiver) => ({
      caregiver,
      hours: schedules
        .filter((schedule) => schedule.caregiver === caregiver || schedule.substitute === caregiver)
        .reduce((sum, schedule) => sum + serviceHours(schedule), 0),
    }));

    return {
      caregivers: new Set(activeSchedules.map((schedule) => schedule.substitute ?? schedule.caregiver)).size,
      clients: new Set(activeSchedules.map((schedule) => schedule.client)).size,
      totalHours,
      crossDistrict: schedules.filter((schedule) => schedule.crossDistrict && schedule.status !== "cancelled").length,
      cancelled: schedules.filter((schedule) => schedule.status === "cancelled").length,
      substitute: schedules.filter((schedule) => schedule.status === "substitute").length,
      caregiverHours,
    };
  }, [schedules]);

  const updateForm = (key: keyof HomecareForm, value: string | boolean) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError("");
  };

  const addSchedule = () => {
    if (!form.client.trim() || !form.address.trim()) {
      setError("請填寫個案與服務地址。");
      setMessage("居服排班尚未建立。");
      return;
    }

    const schedule: HomecareSchedule = {
      id: `HC-20260518-${String(schedules.length + 1).padStart(3, "0")}`,
      caregiver: form.caregiver,
      client: form.client.trim(),
      address: form.address.trim(),
      district: form.district.trim() || "未指定",
      startTime: form.startTime,
      endTime: form.endTime,
      serviceItems: form.serviceItems
        .split(/[、,，]/)
        .map((item) => item.trim())
        .filter(Boolean),
      travelMinutes: Number(form.travelMinutes) || 0,
      crossDistrict: form.crossDistrict,
      gpsLat: Number(form.gpsLat) || 0,
      gpsLng: Number(form.gpsLng) || 0,
      gpsRadiusMeters: Number(form.gpsRadiusMeters) || 100,
      status: "scheduled",
    };

    setSchedules((current) => [schedule, ...current]);
    setForm(defaultForm);
    setError("");
    setMessage(`已建立 ${schedule.client} 的居服排班，並產生 GPS 打卡範圍 ${schedule.gpsRadiusMeters}m。`);
  };

  const cancelSchedule = (id: string) => {
    const target = schedules.find((schedule) => schedule.id === id);
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id
          ? { ...schedule, status: "cancelled", cancelReason: "個案臨時取消服務，保留原排班紀錄" }
          : schedule,
      ),
    );
    if (target) setMessage(`${target.client} 的服務已標記為個案取消，原排班紀錄已保留。`);
    setError("");
  };

  const assignSubstitute = (id: string) => {
    const target = schedules.find((schedule) => schedule.id === id);
    setSchedules((current) =>
      current.map((schedule) =>
        schedule.id === id
          ? {
              ...schedule,
              status: "substitute",
              substitute: substituteCaregivers[(current.findIndex((item) => item.id === id) + 1) % substituteCaregivers.length],
            }
          : schedule,
      ),
    );
    if (target) setMessage(`${target.client} 的服務已安排臨時代班。`);
    setError("");
  };

  const markCompleted = (id: string) => {
    const target = schedules.find((schedule) => schedule.id === id);
    setSchedules((current) =>
      current.map((schedule) => (schedule.id === id ? { ...schedule, status: "completed" } : schedule)),
    );
    if (target) setMessage(`${target.client} 的服務已標記完成。`);
    setError("");
  };

  const maxCaregiverHours = Math.max(...stats.caregiverHours.map((item) => item.hours), 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-medium text-emerald-700">長照排班中心</p>
          <h1 className="text-2xl font-semibold text-slate-950">長照居服員專用排班</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            將居服員、個案、服務地址、服務時段、交通時間與 GPS 打卡地點集中管理，支援跨區服務、個案取消與臨時代班。
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-700">GPS 打卡連動</span>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">跨區服務提醒</span>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sky-700">服務時數統計</span>
        </div>
      </div>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "今日居服員", value: `${stats.caregivers} 人`, icon: UsersRound, tone: "text-emerald-700 bg-emerald-50" },
          { label: "服務個案", value: `${stats.clients} 位`, icon: UserRoundCheck, tone: "text-sky-700 bg-sky-50" },
          { label: "服務時數統計", value: `${stats.totalHours.toFixed(1)} 小時`, icon: Clock3, tone: "text-violet-700 bg-violet-50" },
          { label: "跨區服務", value: `${stats.crossDistrict} 筆`, icon: Route, tone: "text-amber-700 bg-amber-50" },
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

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">新增居服排班</h2>
              <p className="text-sm text-slate-500">建立服務時段後，GPS 打卡範圍會同步帶入員工打卡規則。</p>
            </div>
            <CalendarClock className="h-5 w-5 text-emerald-600" />
          </div>

          <div className={`mb-4 rounded-lg px-3 py-2 text-sm font-semibold ${error ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
            {error || message}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              居服員
              <select
                value={form.caregiver}
                onChange={(event) => updateForm("caregiver", event.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {caregivers.map((caregiver) => (
                  <option key={caregiver}>{caregiver}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              個案
              <input
                value={form.client}
                onChange={(event) => updateForm("client", event.target.value)}
                placeholder="例：蔡阿嬤"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              服務地址
              <input
                value={form.address}
                onChange={(event) => updateForm("address", event.target.value)}
                placeholder="輸入個案服務地址"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              服務區域
              <input
                value={form.district}
                onChange={(event) => updateForm("district", event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              交通時間（分鐘）
              <input
                type="number"
                min="0"
                value={form.travelMinutes}
                onChange={(event) => updateForm("travelMinutes", event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              服務開始
              <input
                type="datetime-local"
                value={form.startTime}
                onChange={(event) => updateForm("startTime", event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              服務結束
              <input
                type="datetime-local"
                value={form.endTime}
                onChange={(event) => updateForm("endTime", event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700 md:col-span-2">
              服務項目
              <input
                value={form.serviceItems}
                onChange={(event) => updateForm("serviceItems", event.target.value)}
                placeholder={serviceCatalog.join("、")}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </label>
            <div className="grid gap-3 md:col-span-2 md:grid-cols-3">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                GPS 緯度
                <input
                  value={form.gpsLat}
                  onChange={(event) => updateForm("gpsLat", event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                GPS 經度
                <input
                  value={form.gpsLng}
                  onChange={(event) => updateForm("gpsLng", event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                打卡半徑（公尺）
                <input
                  type="number"
                  min="30"
                  value={form.gpsRadiusMeters}
                  onChange={(event) => updateForm("gpsRadiusMeters", event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.crossDistrict}
                onChange={(event) => updateForm("crossDistrict", event.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              跨區服務，需要計入交通緩衝與主管提醒
            </label>
          </div>

          <button
            onClick={addSchedule}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            建立排班
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">GPS 打卡地點連動</h2>
              <p className="text-sm text-slate-500">每筆個案服務地址都可轉成允許打卡範圍。</p>
            </div>
            <Crosshair className="h-5 w-5 text-sky-600" />
          </div>

          <div className="relative h-72 overflow-hidden rounded-lg border border-slate-200 bg-[linear-gradient(90deg,#e2e8f0_1px,transparent_1px),linear-gradient(#e2e8f0_1px,transparent_1px)] bg-[size:28px_28px]">
            <div className="absolute inset-4 rounded-lg bg-white/70" />
            {schedules.map((schedule) => {
              const pos = mapPosition(schedule.gpsLat, schedule.gpsLng);
              return (
                <div
                  key={schedule.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: pos.left, top: pos.top }}
                >
                  <span
                    className={`absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border ${
                      schedule.status === "cancelled" ? "border-rose-300 bg-rose-100/50" : "border-emerald-300 bg-emerald-100/50"
                    }`}
                  />
                  <span
                    className={`relative flex h-7 w-7 items-center justify-center rounded-full text-white shadow-sm ${
                      schedule.status === "cancelled" ? "bg-rose-500" : schedule.crossDistrict ? "bg-amber-500" : "bg-emerald-600"
                    }`}
                    title={`${schedule.client} ${schedule.gpsRadiusMeters}m`}
                  >
                    <MapPin className="h-4 w-4" />
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-4 grid gap-3 text-sm">
            {schedules.slice(0, 4).map((schedule) => (
              <div key={schedule.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div>
                  <p className="font-semibold text-slate-900">{schedule.client}</p>
                  <p className="text-xs text-slate-500">
                    {schedule.gpsLat.toFixed(3)}, {schedule.gpsLng.toFixed(3)} · 半徑 {schedule.gpsRadiusMeters}m
                  </p>
                </div>
                <a
                  href={getGoogleMapsUrl(schedule.gpsLat, schedule.gpsLng)}
                  className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-bold text-sky-700 hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  Google Maps
                </a>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.5fr_0.7fr]">
        <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-5">
            <h2 className="text-lg font-semibold text-slate-950">居服排班清單</h2>
            <p className="text-sm text-slate-500">完整顯示服務地址、服務時段、服務項目、交通時間、跨區服務與 GPS 打卡地點。</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">居服員 / 個案</th>
                  <th className="px-4 py-3">服務地址</th>
                  <th className="px-4 py-3">服務時段</th>
                  <th className="px-4 py-3">服務項目</th>
                  <th className="px-4 py-3">交通時間</th>
                  <th className="px-4 py-3">GPS 打卡地點</th>
                  <th className="px-4 py-3">狀態</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {schedules.map((schedule) => (
                  <tr key={schedule.id} className="align-top hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <p className="font-semibold text-slate-950">{schedule.substitute ?? schedule.caregiver}</p>
                      {schedule.substitute ? (
                        <p className="text-xs text-amber-600">原排班：{schedule.caregiver}</p>
                      ) : (
                        <p className="text-xs text-slate-500">排班編號：{schedule.id}</p>
                      )}
                      <p className="mt-1 text-sm text-slate-700">個案：{schedule.client}</p>
                    </td>
                    <td className="px-4 py-4">
                      <p className="max-w-xs font-medium text-slate-800">{schedule.address}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">{schedule.district}</span>
                        {schedule.crossDistrict ? (
                          <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">跨區服務</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-800">{formatTimeRange(schedule.startTime, schedule.endTime)}</p>
                      <p className="text-xs text-slate-500">服務 {serviceHours(schedule).toFixed(1)} 小時</p>
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex max-w-xs flex-wrap gap-1.5">
                        {schedule.serviceItems.map((item) => (
                          <span key={`${schedule.id}-${item}`} className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                            {item}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-slate-700">
                        <Car className="h-4 w-4 text-slate-500" />
                        {schedule.travelMinutes} 分
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <p className="font-medium text-slate-800">
                        {schedule.gpsLat.toFixed(4)}, {schedule.gpsLng.toFixed(4)}
                      </p>
                      <p className="text-xs text-slate-500">允許半徑 {schedule.gpsRadiusMeters} 公尺</p>
                      <a
                        href={getGoogleMapsUrl(schedule.gpsLat, schedule.gpsLng)}
                        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-sky-700 hover:underline"
                      >
                        <ExternalLink className="h-3 w-3" />
                        Google Maps
                      </a>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusStyles[schedule.status]}`}>
                        {statusLabels[schedule.status]}
                      </span>
                      {schedule.cancelReason ? <p className="mt-2 text-xs text-rose-600">{schedule.cancelReason}</p> : null}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-2">
                        <button
                          onClick={() => markCompleted(schedule.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          完成
                        </button>
                        <button
                          onClick={() => assignSubstitute(schedule.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          臨時代班
                        </button>
                        <button
                          onClick={() => cancelSchedule(schedule.id)}
                          className="inline-flex items-center justify-center gap-2 rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          個案取消
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="h-5 w-5 text-violet-600" />
              <h2 className="text-lg font-semibold text-slate-950">服務時數統計</h2>
            </div>
            <div className="space-y-4">
              {stats.caregiverHours.map((item) => (
                <div key={item.caregiver}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700">{item.caregiver}</span>
                    <span className="text-slate-500">{item.hours.toFixed(1)} 小時</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <div
                      className="h-2 rounded-full bg-violet-500"
                      style={{ width: `${Math.max((item.hours / maxCaregiverHours) * 100, item.hours ? 12 : 0)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-700" />
              <div>
                <h2 className="font-semibold text-amber-900">排班防呆提醒</h2>
                <p className="mt-1 text-sm text-amber-800">
                  跨區服務會自動帶入交通緩衝；個案取消與臨時代班會保留原始紀錄，後續可串接通知與薪資服務時數計算。
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-slate-950">今日異動摘要</h2>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-xs font-medium text-rose-600">個案取消</p>
                <p className="mt-1 text-2xl font-semibold text-rose-700">{stats.cancelled}</p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs font-medium text-amber-600">臨時代班</p>
                <p className="mt-1 text-2xl font-semibold text-amber-700">{stats.substitute}</p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
