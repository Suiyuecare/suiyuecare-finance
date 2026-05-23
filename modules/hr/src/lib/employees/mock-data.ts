export type EmployeeStatus = "active" | "on_leave" | "suspended" | "terminated";
export type Gender = "female" | "male" | "not_disclosed";

export type Employee = {
  employeeNo: string;
  name: string;
  englishName: string;
  nationalId: string;
  birthday: string;
  gender: Gender;
  department: string;
  branch: string;
  position: string;
  hireDate: string;
  terminationDate: string;
  company: string;
  supervisor: string;
  status: EmployeeStatus;
  phone: string;
  email: string;
  registeredAddress: string;
  mailingAddress: string;
  emergencyContact: string;
  emergencyPhone: string;
};

export const statusLabels: Record<EmployeeStatus, string> = {
  active: "在職",
  on_leave: "留停",
  suspended: "停權",
  terminated: "離職",
};

export const statusClassNames: Record<EmployeeStatus, string> = {
  active: "bg-emerald-600",
  on_leave: "bg-sky-600",
  suspended: "bg-amber-600",
  terminated: "bg-slate-500",
};

export const genderLabels: Record<Gender, string> = {
  female: "女性",
  male: "男性",
  not_disclosed: "不揭露",
};

export const initialEmployees: Employee[] = [
  {
    employeeNo: "HR-001",
    name: "陳羽俊",
    englishName: "Yu-Chun Chen",
    nationalId: "A123456789",
    birthday: "1988-07-12",
    gender: "male",
    department: "人資部",
    branch: "總公司",
    position: "人資主管",
    hireDate: "2021-03-15",
    terminationDate: "",
    company: "歲悅長照股份有限公司",
    supervisor: "林董事長",
    status: "active",
    phone: "0912-345-001",
    email: "hr.manager@suiyuecare.com",
    registeredAddress: "台北市中正區仁愛路一段 1 號",
    mailingAddress: "台北市中正區仁愛路一段 1 號",
    emergencyContact: "陳雅玲",
    emergencyPhone: "0912-000-001",
  },
  {
    employeeNo: "HC-018",
    name: "林佳穎",
    englishName: "Chia-Ying Lin",
    nationalId: "B223456789",
    birthday: "1992-04-18",
    gender: "female",
    department: "居家服務部",
    branch: "台北居服站",
    position: "居服員",
    hireDate: "2024-08-01",
    terminationDate: "",
    company: "歲悅長照股份有限公司",
    supervisor: "王淑芬",
    status: "active",
    phone: "0912-345-018",
    email: "chia-ying.lin@suiyuecare.com",
    registeredAddress: "新北市板橋區文化路二段 18 號",
    mailingAddress: "新北市板橋區文化路二段 18 號",
    emergencyContact: "林志明",
    emergencyPhone: "0912-000-018",
  },
  {
    employeeNo: "HC-026",
    name: "王淑芬",
    englishName: "Shu-Fen Wang",
    nationalId: "C223456789",
    birthday: "1985-09-03",
    gender: "female",
    department: "居家服務部",
    branch: "桃園據點",
    position: "居服督導",
    hireDate: "2023-01-11",
    terminationDate: "",
    company: "歲悅長照股份有限公司",
    supervisor: "陳羽俊",
    status: "active",
    phone: "0912-345-026",
    email: "shu-fen.wang@suiyuecare.com",
    registeredAddress: "桃園市桃園區中正路 26 號",
    mailingAddress: "桃園市桃園區中正路 26 號",
    emergencyContact: "王志偉",
    emergencyPhone: "0912-000-026",
  },
  {
    employeeNo: "DC-009",
    name: "黃冠宇",
    englishName: "Guan-Yu Huang",
    nationalId: "D123456789",
    birthday: "1995-02-21",
    gender: "male",
    department: "日照中心",
    branch: "新北日照中心",
    position: "照服員",
    hireDate: "2026-05-01",
    terminationDate: "",
    company: "歲悅日照有限公司",
    supervisor: "陳柏宏",
    status: "active",
    phone: "0912-345-009",
    email: "guan-yu.huang@suiyuecare.com",
    registeredAddress: "新北市新店區北新路三段 9 號",
    mailingAddress: "新北市新店區北新路三段 9 號",
    emergencyContact: "黃美玲",
    emergencyPhone: "0912-000-009",
  },
  {
    employeeNo: "DC-012",
    name: "陳柏宏",
    englishName: "Bo-Hong Chen",
    nationalId: "E123456789",
    birthday: "1987-11-16",
    gender: "male",
    department: "日照中心",
    branch: "新北日照中心",
    position: "護理師",
    hireDate: "2022-11-07",
    terminationDate: "",
    company: "歲悅日照有限公司",
    supervisor: "陳羽俊",
    status: "on_leave",
    phone: "0912-345-012",
    email: "bo-hong.chen@suiyuecare.com",
    registeredAddress: "新北市永和區中山路一段 12 號",
    mailingAddress: "新北市永和區中山路一段 12 號",
    emergencyContact: "陳怡君",
    emergencyPhone: "0912-000-012",
  },
  {
    employeeNo: "FN-003",
    name: "張雅雯",
    englishName: "Ya-Wen Chang",
    nationalId: "F223456789",
    birthday: "1990-06-30",
    gender: "female",
    department: "會計部",
    branch: "總公司",
    position: "會計人員",
    hireDate: "2020-06-22",
    terminationDate: "",
    company: "歲悅長照股份有限公司",
    supervisor: "陳羽俊",
    status: "active",
    phone: "0912-345-003",
    email: "accounting@suiyuecare.com",
    registeredAddress: "台北市大安區復興南路一段 3 號",
    mailingAddress: "台北市大安區復興南路一段 3 號",
    emergencyContact: "張文宏",
    emergencyPhone: "0912-000-003",
  },
  {
    employeeNo: "OP-014",
    name: "吳宗翰",
    englishName: "Tsung-Han Wu",
    nationalId: "G123456789",
    birthday: "1983-12-08",
    gender: "male",
    department: "營運部",
    branch: "台中據點",
    position: "據點主管",
    hireDate: "2021-09-13",
    terminationDate: "",
    company: "歲悅長照股份有限公司",
    supervisor: "陳羽俊",
    status: "suspended",
    phone: "0912-345-014",
    email: "tsung-han.wu@suiyuecare.com",
    registeredAddress: "台中市西屯區市政路 14 號",
    mailingAddress: "台中市西屯區市政路 14 號",
    emergencyContact: "吳佳玲",
    emergencyPhone: "0912-000-014",
  },
  {
    employeeNo: "HC-041",
    name: "周雅婷",
    englishName: "Ya-Ting Chou",
    nationalId: "H223456789",
    birthday: "1991-03-25",
    gender: "female",
    department: "居家服務部",
    branch: "高雄居服站",
    position: "居服員",
    hireDate: "2025-10-20",
    terminationDate: "2026-05-31",
    company: "歲悅長照股份有限公司",
    supervisor: "王淑芬",
    status: "terminated",
    phone: "0912-345-041",
    email: "ya-ting.chou@suiyuecare.com",
    registeredAddress: "高雄市左營區博愛二路 41 號",
    mailingAddress: "高雄市左營區博愛二路 41 號",
    emergencyContact: "周美惠",
    emergencyPhone: "0912-000-041",
  },
];
