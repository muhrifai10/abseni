"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 5173);
const TZ = "Asia/Jakarta";
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const ACCESS_SECRET = process.env.ACCESS_TOKEN_SECRET || "dev-access-secret-change-me";
const REFRESH_SECRET = process.env.REFRESH_TOKEN_SECRET || "dev-refresh-secret-change-me";
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

const rateBuckets = new Map();

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hashPassword(password, salt) {
  return crypto.createHash("sha256").update(`${salt}:${password}`).digest("hex");
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function signToken(payload, secret, ttlSeconds) {
  const header = { alg: "HS256", typ: "JWT" };
  const body = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    iat: Math.floor(Date.now() / 1000)
  };
  const encodedHeader = base64url(JSON.stringify(header));
  const encodedBody = base64url(JSON.stringify(body));
  const signature = crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest("base64url");
  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedBody, signature] = parts;
  const expected = crypto.createHmac("sha256", secret).update(`${encodedHeader}.${encodedBody}`).digest("base64url");
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encodedBody, "base64url").toString("utf8"));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function nowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time: `${map.hour}:${map.minute}:${map.second}`,
    minutes: Number(map.hour) * 60 + Number(map.minute)
  };
}

function isoNow() {
  return new Date().toISOString();
}

function minutesFromTime(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number);
  return hour * 60 + minute;
}

function timeDiffHours(start, end) {
  let startMinutes = minutesFromTime(start);
  let endMinutes = minutesFromTime(end);
  if (endMinutes < startMinutes) endMinutes += 24 * 60;
  return Math.round(((endMinutes - startMinutes) / 60) * 100) / 100;
}

function dateRange(startDate, endDate) {
  const dates = [];
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  for (let date = start; date <= end; date.setUTCDate(date.getUTCDate() + 1)) {
    dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function isWeekend(ymd) {
  const day = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function haversineMeters(lat1, lng1, lat2, lng2) {
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const earth = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function nextId(db, collection) {
  db.meta.nextIds[collection] = (db.meta.nextIds[collection] || 1) + 1;
  return db.meta.nextIds[collection] - 1;
}

function createUserSeed(id, nik, name, email, role, departmentId, branchId, shiftId, managerId, position, leaveBalance = 12) {
  const salt = `seed-${id}-${role}`;
  return {
    id,
    nik,
    name,
    email,
    role,
    departmentId,
    branchId,
    shiftId,
    managerId,
    position,
    phone: "0812-0000-0000",
    address: "Jakarta",
    photoUrl: "",
    leaveBalance,
    employmentStatus: "Aktif",
    passwordSalt: salt,
    passwordHash: hashPassword("password123", salt),
    createdAt: isoNow(),
    updatedAt: isoNow()
  };
}

function seedDatabase() {
  const today = nowParts().date;
  const yesterdayDate = new Date(`${today}T00:00:00Z`);
  yesterdayDate.setUTCDate(yesterdayDate.getUTCDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);
  const tomorrowDate = new Date(`${today}T00:00:00Z`);
  tomorrowDate.setUTCDate(tomorrowDate.getUTCDate() + 1);
  const tomorrow = tomorrowDate.toISOString().slice(0, 10);

  return {
    meta: {
      version: 1,
      createdAt: isoNow(),
      nextIds: {
        users: 8,
        attendances: 6,
        leaves: 3,
        overtimes: 3,
        shifts: 4,
        holidays: 4,
        departments: 5,
        branches: 3,
        announcements: 3,
        auditLogs: 3,
        notifications: 6,
        shiftSchedules: 8
      }
    },
    company: {
      name: "Nusantara Attendance",
      timezone: TZ,
      annualLeaveDays: 12
    },
    settings: {
      geofenceDefaultRadiusMeters: 100,
      workFromHomeRequiresApproval: true,
      maxOvertimeHoursPerDay: 4,
      maxOvertimeHoursPerWeek: 18,
      overtimeRatePerHour: 50000,
      reminderMinutesAfterStart: 30,
      faceRecognitionEnabled: false
    },
    branches: [
      {
        id: 1,
        name: "Kantor Pusat Jakarta",
        address: "Jl. Sudirman No. 10, Jakarta",
        lat: -6.2088,
        lng: 106.8456,
        radiusMeters: 100
      },
      {
        id: 2,
        name: "Cabang Bandung",
        address: "Jl. Asia Afrika No. 5, Bandung",
        lat: -6.9175,
        lng: 107.6191,
        radiusMeters: 120
      }
    ],
    departments: [
      { id: 1, name: "Executive" },
      { id: 2, name: "Human Resource" },
      { id: 3, name: "Engineering" },
      { id: 4, name: "Sales" }
    ],
    shifts: [
      { id: 1, name: "Pagi", startTime: "08:00", endTime: "17:00", toleranceMinutes: 15, breakMinutes: 60 },
      { id: 2, name: "Siang", startTime: "13:00", endTime: "22:00", toleranceMinutes: 10, breakMinutes: 60 },
      { id: 3, name: "Malam", startTime: "22:00", endTime: "06:00", toleranceMinutes: 10, breakMinutes: 60 }
    ],
    users: [
      createUserSeed(1, "SA-001", "Alya Prameswari", "super@company.test", "super_admin", 1, 1, 1, null, "Super Admin", 12),
      createUserSeed(2, "HR-001", "Bima Rahadian", "hrd@company.test", "hrd_admin", 2, 1, 1, 1, "HRD Admin", 12),
      createUserSeed(3, "MG-001", "Citra Lestari", "manager@company.test", "manager", 3, 1, 1, 2, "Engineering Manager", 10),
      createUserSeed(4, "EMP-001", "Dhani Saputra", "karyawan@company.test", "employee", 3, 1, 1, 3, "Frontend Engineer", 9),
      createUserSeed(5, "EMP-002", "Eka Wulandari", "eka@company.test", "employee", 3, 1, 2, 3, "Backend Engineer", 12),
      createUserSeed(6, "SL-001", "Farhan Nugraha", "sales@company.test", "manager", 4, 2, 1, 2, "Sales Manager", 12),
      createUserSeed(7, "EMP-003", "Gita Permata", "gita@company.test", "employee", 4, 2, 1, 6, "Account Executive", 11)
    ],
    shiftSchedules: [
      { id: 1, userId: 4, date: today, shiftId: 1 },
      { id: 2, userId: 5, date: today, shiftId: 2 },
      { id: 3, userId: 7, date: today, shiftId: 1 },
      { id: 4, userId: 4, date: tomorrow, shiftId: 2 },
      { id: 5, userId: 5, date: tomorrow, shiftId: 1 },
      { id: 6, userId: 7, date: tomorrow, shiftId: 1 },
      { id: 7, userId: 4, date: yesterday, shiftId: 1 }
    ],
    attendances: [
      {
        id: 1,
        userId: 4,
        date: yesterday,
        clockIn: `${yesterday}T01:55:00.000Z`,
        clockOut: `${yesterday}T10:05:00.000Z`,
        clockInLocalTime: "08:55:00",
        clockOutLocalTime: "17:05:00",
        latIn: -6.2088,
        lngIn: 106.8456,
        latOut: -6.2088,
        lngOut: 106.8456,
        branchId: 1,
        status: "Hadir",
        lateMinutes: 0,
        earlyLeaveMinutes: 0,
        workMinutes: 490,
        withinGeofence: true,
        distanceMeters: 0,
        wfh: false,
        notes: "Seed data",
        correctionLog: []
      },
      {
        id: 2,
        userId: 5,
        date: yesterday,
        clockIn: `${yesterday}T06:20:00.000Z`,
        clockOut: `${yesterday}T14:30:00.000Z`,
        clockInLocalTime: "13:20:00",
        clockOutLocalTime: "21:30:00",
        latIn: -6.2088,
        lngIn: 106.8456,
        latOut: -6.2088,
        lngOut: 106.8456,
        branchId: 1,
        status: "Terlambat",
        lateMinutes: 10,
        earlyLeaveMinutes: 30,
        workMinutes: 430,
        withinGeofence: true,
        distanceMeters: 0,
        wfh: false,
        notes: "Seed data",
        correctionLog: []
      }
    ],
    leaves: [
      {
        id: 1,
        userId: 4,
        type: "Cuti Tahunan",
        startDate: tomorrow,
        endDate: tomorrow,
        days: 1,
        reason: "Urusan keluarga",
        attachmentName: "",
        status: "Menunggu HRD",
        currentStep: "hrd",
        managerApproverId: 3,
        hrApproverId: null,
        history: [
          { by: 4, action: "Diajukan", comment: "", at: isoNow() },
          { by: 3, action: "Disetujui Manager", comment: "OK", at: isoNow() }
        ],
        createdAt: isoNow(),
        updatedAt: isoNow()
      },
      {
        id: 2,
        userId: 7,
        type: "Dinas Luar",
        startDate: today,
        endDate: today,
        days: 1,
        reason: "Meeting klien di luar kantor",
        attachmentName: "surat-tugas.pdf",
        status: "Disetujui",
        currentStep: "done",
        managerApproverId: 6,
        hrApproverId: 2,
        history: [
          { by: 7, action: "Diajukan", comment: "", at: isoNow() },
          { by: 6, action: "Disetujui Manager", comment: "Agenda sales", at: isoNow() },
          { by: 2, action: "Disetujui HRD", comment: "Tercatat", at: isoNow() }
        ],
        createdAt: isoNow(),
        updatedAt: isoNow()
      }
    ],
    overtimes: [
      {
        id: 1,
        userId: 4,
        date: today,
        startTime: "18:00",
        endTime: "20:00",
        hours: 2,
        reason: "Deployment fitur absensi",
        status: "Menunggu Manager",
        approverId: 3,
        costEstimate: 100000,
        history: [{ by: 4, action: "Diajukan", comment: "", at: isoNow() }],
        createdAt: isoNow(),
        updatedAt: isoNow()
      },
      {
        id: 2,
        userId: 5,
        date: yesterday,
        startTime: "22:00",
        endTime: "23:30",
        hours: 1.5,
        reason: "Maintenance database",
        status: "Disetujui",
        approverId: 3,
        costEstimate: 75000,
        history: [
          { by: 5, action: "Diajukan", comment: "", at: isoNow() },
          { by: 3, action: "Disetujui", comment: "Sesuai jadwal maintenance", at: isoNow() }
        ],
        createdAt: isoNow(),
        updatedAt: isoNow()
      }
    ],
    holidays: [
      { id: 1, date: "2026-01-01", name: "Tahun Baru Masehi", type: "Nasional" },
      { id: 2, date: "2026-05-01", name: "Hari Buruh", type: "Nasional" },
      { id: 3, date: "2026-08-17", name: "Hari Kemerdekaan RI", type: "Nasional" }
    ],
    announcements: [
      {
        id: 1,
        title: "Reminder absensi",
        body: "Jangan lupa check-in sebelum jam kerja dan check-out setelah selesai bekerja.",
        audience: "all",
        createdBy: 2,
        createdAt: isoNow()
      },
      {
        id: 2,
        title: "Import karyawan via CSV",
        body: "HRD dapat mengunggah data karyawan baru melalui menu Karyawan.",
        audience: "hrd_admin",
        createdBy: 1,
        createdAt: isoNow()
      }
    ],
    auditLogs: [
      { id: 1, actorId: 1, action: "SYSTEM_SEEDED", entity: "database", entityId: "seed", details: "Initial demo data", at: isoNow() },
      { id: 2, actorId: 3, action: "LEAVE_MANAGER_APPROVED", entity: "leave", entityId: 1, details: "Seed approval", at: isoNow() }
    ],
    notifications: [
      { id: 1, userId: 2, title: "Approval cuti menunggu", body: "Dhani Saputra menunggu persetujuan HRD.", read: false, createdAt: isoNow() },
      { id: 2, userId: 3, title: "Lembur baru", body: "Dhani Saputra mengajukan lembur hari ini.", read: false, createdAt: isoNow() },
      { id: 3, userId: 4, title: "Pengajuan cuti diproses", body: "Cuti Anda sudah disetujui Manager dan menunggu HRD.", read: false, createdAt: isoNow() },
      { id: 4, userId: 1, title: "Database siap", body: "Data demo absensi berhasil dibuat.", read: true, createdAt: isoNow() },
      { id: 5, userId: 6, title: "Kalender tim", body: "Gita sedang dinas luar hari ini.", read: false, createdAt: isoNow() }
    ]
  };
}

function loadDb() {
  ensureDir(DATA_DIR);
  if (!fs.existsSync(DB_FILE)) {
    const seeded = seedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(seeded, null, 2));
    return seeded;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveDb(db) {
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function publicUser(user) {
  if (!user) return null;
  const clone = { ...user };
  delete clone.passwordHash;
  delete clone.passwordSalt;
  return clone;
}

function withLookups(db, user) {
  const clean = publicUser(user);
  return {
    ...clean,
    department: db.departments.find((item) => item.id === user.departmentId)?.name || "-",
    branch: db.branches.find((item) => item.id === user.branchId)?.name || "-",
    shift: db.shifts.find((item) => item.id === user.shiftId)?.name || "-"
  };
}

function isPrivileged(user) {
  return user && ["super_admin", "hrd_admin"].includes(user.role);
}

function canManageEmployee(actor, employee) {
  if (!actor || !employee) return false;
  if (isPrivileged(actor)) return true;
  if (actor.role === "manager") return employee.managerId === actor.id || employee.id === actor.id;
  return employee.id === actor.id;
}

function canReviewLeave(actor, db, leave) {
  if (!actor || !leave) return false;
  if (actor.role === "super_admin") return true;
  if (leave.currentStep === "manager") return actor.role === "manager" && leave.managerApproverId === actor.id;
  if (leave.currentStep === "hrd") return actor.role === "hrd_admin";
  return false;
}

function canReviewOvertime(actor, overtime) {
  if (!actor || !overtime) return false;
  if (actor.role === "super_admin" || actor.role === "hrd_admin") return true;
  return actor.role === "manager" && overtime.approverId === actor.id;
}

function getShiftForUser(db, userId, date) {
  const user = db.users.find((item) => item.id === userId);
  const schedule = db.shiftSchedules.find((item) => item.userId === userId && item.date === date);
  return db.shifts.find((item) => item.id === (schedule?.shiftId || user?.shiftId));
}

function countBusinessDays(db, startDate, endDate) {
  const holidaySet = new Set(db.holidays.map((holiday) => holiday.date));
  return dateRange(startDate, endDate).filter((date) => !isWeekend(date) && !holidaySet.has(date)).length;
}

function hasApprovedWfhOrExternal(db, userId, date) {
  return db.leaves.some(
    (leave) =>
      leave.userId === userId &&
      leave.status === "Disetujui" &&
      ["Dinas Luar", "Izin Khusus", "WFH"].includes(leave.type) &&
      leave.startDate <= date &&
      leave.endDate >= date
  );
}

function addAudit(db, actorId, action, entity, entityId, details) {
  db.auditLogs.unshift({
    id: nextId(db, "auditLogs"),
    actorId,
    action,
    entity,
    entityId,
    details,
    at: isoNow()
  });
}

function addNotification(db, userId, title, body) {
  if (!userId) return;
  db.notifications.unshift({
    id: nextId(db, "notifications"),
    userId,
    title,
    body,
    read: false,
    createdAt: isoNow()
  });
}

function getScopedUsers(db, actor) {
  if (isPrivileged(actor)) return db.users;
  if (actor.role === "manager") return db.users.filter((user) => user.id === actor.id || user.managerId === actor.id);
  return db.users.filter((user) => user.id === actor.id);
}

function getScopedAttendances(db, actor, query = {}) {
  const allowedIds = new Set(getScopedUsers(db, actor).map((user) => user.id));
  return db.attendances.filter((attendance) => {
    if (!allowedIds.has(attendance.userId)) return false;
    if (query.userId && attendance.userId !== Number(query.userId)) return false;
    if (query.from && attendance.date < query.from) return false;
    if (query.to && attendance.date > query.to) return false;
    return true;
  });
}

function getLeaveRows(db, actor) {
  const allowedIds = new Set(getScopedUsers(db, actor).map((user) => user.id));
  return db.leaves.filter((leave) => {
    if (isPrivileged(actor)) return true;
    if (actor.role === "manager") return allowedIds.has(leave.userId) || leave.managerApproverId === actor.id;
    return leave.userId === actor.id;
  });
}

function getOvertimeRows(db, actor) {
  const allowedIds = new Set(getScopedUsers(db, actor).map((user) => user.id));
  return db.overtimes.filter((overtime) => {
    if (isPrivileged(actor)) return true;
    if (actor.role === "manager") return allowedIds.has(overtime.userId) || overtime.approverId === actor.id;
    return overtime.userId === actor.id;
  });
}

function buildAttendanceSummary(db, actor, query = {}) {
  const users = getScopedUsers(db, actor).filter((user) => {
    if (query.departmentId && user.departmentId !== Number(query.departmentId)) return false;
    if (query.userId && user.id !== Number(query.userId)) return false;
    return user.employmentStatus === "Aktif";
  });
  const from = query.from || nowParts().date;
  const to = query.to || query.from || nowParts().date;
  const days = dateRange(from, to);
  const holidaySet = new Set(db.holidays.map((holiday) => holiday.date));

  return users.map((user) => {
    const rows = db.attendances.filter((attendance) => attendance.userId === user.id && attendance.date >= from && attendance.date <= to);
    const leaveDays = db.leaves
      .filter((leave) => leave.userId === user.id && leave.status === "Disetujui")
      .flatMap((leave) => dateRange(leave.startDate, leave.endDate))
      .filter((date) => date >= from && date <= to).length;
    const scheduledWorkDays = days.filter((date) => !isWeekend(date) && !holidaySet.has(date)).length;
    const present = rows.filter((row) => ["Hadir", "Terlambat"].includes(row.status)).length;
    const late = rows.filter((row) => row.status === "Terlambat").length;
    const earlyLeave = rows.filter((row) => Number(row.earlyLeaveMinutes || 0) > 0).length;
    const alpha = Math.max(scheduledWorkDays - present - leaveDays, 0);
    const totalWorkMinutes = rows.reduce((sum, row) => sum + Number(row.workMinutes || 0), 0);
    const overtimeHours = db.overtimes
      .filter((overtime) => overtime.userId === user.id && overtime.status === "Disetujui" && overtime.date >= from && overtime.date <= to)
      .reduce((sum, overtime) => sum + Number(overtime.hours || 0), 0);
    return {
      userId: user.id,
      nik: user.nik,
      name: user.name,
      department: db.departments.find((department) => department.id === user.departmentId)?.name || "-",
      branch: db.branches.find((branch) => branch.id === user.branchId)?.name || "-",
      present,
      late,
      earlyLeave,
      alpha,
      leaveDays,
      totalWorkHours: Math.round((totalWorkMinutes / 60) * 100) / 100,
      overtimeHours,
      overtimeCost: Math.round(overtimeHours * Number(db.settings.overtimeRatePerHour || 0))
    };
  });
}

function dashboardPayload(db, actor) {
  const today = nowParts().date;
  const scopedUsers = getScopedUsers(db, actor).filter((user) => user.employmentStatus === "Aktif");
  const scopedIds = new Set(scopedUsers.map((user) => user.id));
  const todayRows = db.attendances.filter((row) => row.date === today && scopedIds.has(row.userId));
  const approvedLeavesToday = db.leaves.filter(
    (leave) => leave.status === "Disetujui" && leave.startDate <= today && leave.endDate >= today && scopedIds.has(leave.userId)
  );
  const workday = !isWeekend(today) && !db.holidays.some((holiday) => holiday.date === today);
  const present = todayRows.filter((row) => ["Hadir", "Terlambat"].includes(row.status)).length;
  const late = todayRows.filter((row) => row.status === "Terlambat").length;
  const alpha = workday ? Math.max(scopedUsers.length - present - approvedLeavesToday.length, 0) : 0;
  const pendingLeaves = getLeaveRows(db, actor).filter((leave) => ["Menunggu Manager", "Menunggu HRD"].includes(leave.status));
  const pendingOvertimes = getOvertimeRows(db, actor).filter((overtime) => overtime.status === "Menunggu Manager");
  const trendDays = dateRange(
    new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10),
    today
  );
  const trend = trendDays.map((date) => {
    const rows = db.attendances.filter((row) => row.date === date && scopedIds.has(row.userId));
    return {
      date,
      present: rows.filter((row) => ["Hadir", "Terlambat"].includes(row.status)).length,
      late: rows.filter((row) => row.status === "Terlambat").length
    };
  });

  return {
    date: today,
    company: db.company,
    stats: {
      employees: scopedUsers.length,
      present,
      late,
      alpha,
      onLeave: approvedLeavesToday.length,
      pendingLeaves: pendingLeaves.length,
      pendingOvertimes: pendingOvertimes.length
    },
    trend,
    todayAttendances: todayRows.map((row) => enrichAttendance(db, row)),
    pendingLeaves: pendingLeaves.slice(0, 8).map((leave) => enrichLeave(db, leave)),
    pendingOvertimes: pendingOvertimes.slice(0, 8).map((overtime) => enrichOvertime(db, overtime)),
    announcements: db.announcements.slice(0, 5)
  };
}

function enrichAttendance(db, attendance) {
  const user = db.users.find((item) => item.id === attendance.userId);
  const branch = db.branches.find((item) => item.id === attendance.branchId);
  const shift = getShiftForUser(db, attendance.userId, attendance.date);
  return {
    ...attendance,
    userName: user?.name || "-",
    nik: user?.nik || "-",
    department: db.departments.find((department) => department.id === user?.departmentId)?.name || "-",
    branchName: branch?.name || "-",
    shiftName: shift?.name || "-"
  };
}

function enrichLeave(db, leave) {
  const user = db.users.find((item) => item.id === leave.userId);
  return {
    ...leave,
    userName: user?.name || "-",
    department: db.departments.find((department) => department.id === user?.departmentId)?.name || "-",
    managerName: db.users.find((item) => item.id === leave.managerApproverId)?.name || "-",
    hrName: db.users.find((item) => item.id === leave.hrApproverId)?.name || "-"
  };
}

function enrichOvertime(db, overtime) {
  const user = db.users.find((item) => item.id === overtime.userId);
  return {
    ...overtime,
    userName: user?.name || "-",
    department: db.departments.find((department) => department.id === user?.departmentId)?.name || "-",
    approverName: db.users.find((item) => item.id === overtime.approverId)?.name || "-"
  };
}

function requireFields(body, fields) {
  for (const field of fields) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      const error = new Error(`Field ${field} wajib diisi.`);
      error.status = 400;
      throw error;
    }
  }
}

function sanitizeText(value, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function parseCsvEmployees(csv) {
  const lines = String(csv || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((header) => header.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((cell) => cell.trim());
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] || "";
    });
    return row;
  });
}

function createEmployee(db, actor, body) {
  requireFields(body, ["nik", "name", "email", "departmentId", "branchId", "shiftId"]);
  if (!isPrivileged(actor)) {
    const error = new Error("Hanya Super Admin atau HRD yang dapat menambah karyawan.");
    error.status = 403;
    throw error;
  }
  if (db.users.some((user) => user.email.toLowerCase() === String(body.email).toLowerCase())) {
    const error = new Error("Email sudah terdaftar.");
    error.status = 409;
    throw error;
  }
  const id = nextId(db, "users");
  const salt = `user-${id}-${crypto.randomBytes(6).toString("hex")}`;
  const user = {
    id,
    nik: sanitizeText(body.nik, 40),
    name: sanitizeText(body.name, 120),
    email: sanitizeText(body.email, 160).toLowerCase(),
    role: ["super_admin", "hrd_admin", "manager", "employee"].includes(body.role) ? body.role : "employee",
    departmentId: Number(body.departmentId),
    branchId: Number(body.branchId),
    shiftId: Number(body.shiftId),
    managerId: body.managerId ? Number(body.managerId) : null,
    position: sanitizeText(body.position || "Karyawan", 120),
    phone: sanitizeText(body.phone, 40),
    address: sanitizeText(body.address, 200),
    photoUrl: sanitizeText(body.photoUrl, 500),
    leaveBalance: Number(body.leaveBalance ?? db.settings.annualLeaveDays ?? 12),
    employmentStatus: "Aktif",
    passwordSalt: salt,
    passwordHash: hashPassword(body.password || "password123", salt),
    createdAt: isoNow(),
    updatedAt: isoNow()
  };
  db.users.push(user);
  addAudit(db, actor.id, "EMPLOYEE_CREATED", "user", id, `Karyawan ${user.name} dibuat.`);
  addNotification(db, id, "Akun absensi dibuat", "Gunakan password sementara: password123, lalu ubah di sistem produksi.");
  return user;
}

function buildReportRows(db, actor, query) {
  return buildAttendanceSummary(db, actor, query).map((row, index) => ({
    No: index + 1,
    NIK: row.nik,
    Nama: row.name,
    Departemen: row.department,
    Cabang: row.branch,
    Hadir: row.present,
    Terlambat: row.late,
    "Pulang Awal": row.earlyLeave,
    Alpha: row.alpha,
    "Izin/Cuti": row.leaveDays,
    "Jam Kerja": row.totalWorkHours,
    "Jam Lembur": row.overtimeHours,
    "Biaya Lembur": row.overtimeCost
  }));
}

function crc32(buffer) {
  let table = crc32.table;
  if (!table) {
    table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c >>> 0;
    }
    crc32.table = table;
  }
  let crc = 0xffffffff;
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, "utf8");
    const crc = crc32(content);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      name
    ]);
    localParts.push(localHeader, content);
    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(content.length),
      u32(content.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + content.length;
  }
  const centralSize = centralParts.reduce((sum, item) => sum + item.length, 0);
  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(offset),
    u16(0)
  ]);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

function columnName(index) {
  let name = "";
  let value = index;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function createXlsx(rows) {
  const headers = Object.keys(rows[0] || { "Tidak ada data": "" });
  const allRows = [headers, ...rows.map((row) => headers.map((header) => row[header]))];
  const sheetData = allRows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, cellIndex) => {
          const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
          if (typeof value === "number") return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const entries = [
    {
      name: "[Content_Types].xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        "</Types>"
    },
    {
      name: "_rels/.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>"
    },
    {
      name: "xl/workbook.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        "<sheets><sheet name=\"Rekap Absensi\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>"
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        "</Relationships>"
    },
    {
      name: "xl/styles.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellXfs></styleSheet>'
    },
    {
      name: "xl/worksheets/sheet1.xml",
      content:
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`
    }
  ];
  return createZip(entries);
}

function pdfEscape(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createSimplePdf(title, lines) {
  const objects = [];
  const textLines = [`BT /F1 16 Tf 50 790 Td (${pdfEscape(title)}) Tj`, "/F1 9 Tf 0 -24 Td"];
  lines.slice(0, 48).forEach((line, index) => {
    textLines.push(`(${pdfEscape(line).slice(0, 105)}) Tj`);
    if (index !== lines.length - 1) textLines.push("0 -14 Td");
  });
  textLines.push("ET");
  const stream = textLines.join("\n");
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function checkRateLimit(req) {
  const ip = req.socket.remoteAddress || "local";
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const bucket = rateBuckets.get(ip) || { resetAt: now + windowMs, count: 0 };
  if (now > bucket.resetAt) {
    bucket.resetAt = now + windowMs;
    bucket.count = 0;
  }
  bucket.count += 1;
  rateBuckets.set(ip, bucket);
  if (bucket.count > 600) {
    const error = new Error("Terlalu banyak request. Coba lagi beberapa saat.");
    error.status = 429;
    throw error;
  }
}

function send(res, status, payload, headers = {}) {
  const body = typeof payload === "string" || Buffer.isBuffer(payload) ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": Buffer.isBuffer(payload) ? "application/octet-stream" : "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, payload) {
  send(res, status, payload, { "Content-Type": "application/json; charset=utf-8" });
}

function sendError(res, error) {
  const status = error.status || 500;
  sendJson(res, status, {
    error: error.message || "Terjadi kesalahan server."
  });
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 12 * 1024 * 1024) {
        const error = new Error("Payload terlalu besar.");
        error.status = 413;
        reject(error);
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        const error = new Error("JSON tidak valid.");
        error.status = 400;
        reject(error);
      }
    });
  });
}

function authenticate(req, db) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const payload = verifyToken(token, ACCESS_SECRET);
  if (!payload) {
    const error = new Error("Sesi tidak valid atau kedaluwarsa.");
    error.status = 401;
    throw error;
  }
  const user = db.users.find((item) => item.id === Number(payload.sub) && item.employmentStatus === "Aktif");
  if (!user) {
    const error = new Error("Pengguna tidak ditemukan.");
    error.status = 401;
    throw error;
  }
  return user;
}

function parseQuery(url) {
  const query = {};
  for (const [key, value] of url.searchParams.entries()) query[key] = value;
  return query;
}

function loginResponse(db, user) {
  const accessToken = signToken({ sub: user.id, role: user.role, type: "access" }, ACCESS_SECRET, 2 * 60 * 60);
  const refreshToken = signToken({ sub: user.id, type: "refresh" }, REFRESH_SECRET, 7 * 24 * 60 * 60);
  return {
    accessToken,
    refreshToken,
    user: withLookups(db, user)
  };
}

function routeConfig(db, res) {
  sendJson(res, 200, {
    timezone: TZ,
    serverDate: nowParts(),
    roles: [
      { id: "super_admin", label: "Super Admin" },
      { id: "hrd_admin", label: "HRD / Admin" },
      { id: "manager", label: "Manajer" },
      { id: "employee", label: "Karyawan" }
    ],
    demoAccounts: [
      { role: "Super Admin", email: "super@company.test", password: "password123" },
      { role: "HRD / Admin", email: "hrd@company.test", password: "password123" },
      { role: "Manajer", email: "manager@company.test", password: "password123" },
      { role: "Karyawan", email: "karyawan@company.test", password: "password123" }
    ]
  });
}

async function handleApi(req, res, db, url) {
  const method = req.method;
  const pathname = url.pathname;
  const query = parseQuery(url);

  if (method === "GET" && pathname === "/api/config") return routeConfig(db, res);

  if (method === "POST" && pathname === "/api/auth/login") {
    const body = await parseBody(req);
    requireFields(body, ["email", "password"]);
    const user = db.users.find((item) => item.email.toLowerCase() === String(body.email).toLowerCase());
    if (!user || user.passwordHash !== hashPassword(String(body.password), user.passwordSalt)) {
      const error = new Error("Email atau password salah.");
      error.status = 401;
      throw error;
    }
    addAudit(db, user.id, "LOGIN", "user", user.id, `Login dari ${req.socket.remoteAddress || "local"}`);
    saveDb(db);
    return sendJson(res, 200, loginResponse(db, user));
  }

  if (method === "POST" && pathname === "/api/auth/refresh") {
    const body = await parseBody(req);
    const payload = verifyToken(body.refreshToken, REFRESH_SECRET);
    if (!payload || payload.type !== "refresh") {
      const error = new Error("Refresh token tidak valid.");
      error.status = 401;
      throw error;
    }
    const user = db.users.find((item) => item.id === Number(payload.sub) && item.employmentStatus === "Aktif");
    if (!user) {
      const error = new Error("Pengguna tidak ditemukan.");
      error.status = 401;
      throw error;
    }
    return sendJson(res, 200, loginResponse(db, user));
  }

  const actor = authenticate(req, db);

  if (method === "GET" && pathname === "/api/me") {
    return sendJson(res, 200, { user: withLookups(db, actor), notificationsUnread: db.notifications.filter((item) => item.userId === actor.id && !item.read).length });
  }

  if (method === "GET" && pathname === "/api/dashboard") {
    return sendJson(res, 200, dashboardPayload(db, actor));
  }

  if (method === "GET" && pathname === "/api/master-data") {
    return sendJson(res, 200, {
      branches: db.branches,
      departments: db.departments,
      shifts: db.shifts,
      holidays: db.holidays,
      settings: db.settings,
      managers: db.users.filter((user) => user.role === "manager").map(publicUser)
    });
  }

  if (method === "GET" && pathname === "/api/employees") {
    return sendJson(res, 200, { employees: getScopedUsers(db, actor).map((user) => withLookups(db, user)) });
  }

  if (method === "POST" && pathname === "/api/employees") {
    const body = await parseBody(req);
    const user = createEmployee(db, actor, body);
    saveDb(db);
    return sendJson(res, 201, { employee: withLookups(db, user), message: "Karyawan berhasil ditambahkan." });
  }

  if (method === "POST" && pathname === "/api/employees/import") {
    const body = await parseBody(req);
    if (!isPrivileged(actor)) {
      const error = new Error("Hanya Super Admin atau HRD yang dapat import karyawan.");
      error.status = 403;
      throw error;
    }
    const rows = parseCsvEmployees(body.csv);
    const created = [];
    for (const row of rows) {
      if (!row.email || db.users.some((user) => user.email.toLowerCase() === row.email.toLowerCase())) continue;
      created.push(createEmployee(db, actor, {
        nik: row.nik,
        name: row.nama || row.name,
        email: row.email,
        role: row.role || "employee",
        departmentId: Number(row.department_id || row.departmentid || 3),
        branchId: Number(row.branch_id || row.branchid || 1),
        shiftId: Number(row.shift_id || row.shiftid || 1),
        managerId: Number(row.manager_id || row.managerid || 3),
        position: row.jabatan || row.position || "Karyawan"
      }));
    }
    addAudit(db, actor.id, "EMPLOYEE_CSV_IMPORTED", "user", "bulk", `${created.length} karyawan diimport.`);
    saveDb(db);
    return sendJson(res, 201, { count: created.length, employees: created.map((user) => withLookups(db, user)) });
  }

  if (method === "PATCH" && pathname.startsWith("/api/employees/")) {
    const id = Number(pathname.split("/").pop());
    const employee = db.users.find((user) => user.id === id);
    if (!employee || !canManageEmployee(actor, employee) || (!isPrivileged(actor) && actor.id !== employee.id)) {
      const error = new Error("Tidak punya akses mengubah karyawan ini.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    const allowed = isPrivileged(actor)
      ? ["name", "phone", "address", "position", "departmentId", "branchId", "shiftId", "managerId", "role", "leaveBalance", "employmentStatus"]
      : ["phone", "address", "photoUrl"];
    for (const key of allowed) {
      if (body[key] !== undefined) employee[key] = ["departmentId", "branchId", "shiftId", "managerId", "leaveBalance"].includes(key) ? Number(body[key]) : sanitizeText(body[key], 200);
    }
    employee.updatedAt = isoNow();
    addAudit(db, actor.id, "EMPLOYEE_UPDATED", "user", employee.id, `Data ${employee.name} diperbarui.`);
    saveDb(db);
    return sendJson(res, 200, { employee: withLookups(db, employee) });
  }

  if (method === "GET" && pathname === "/api/attendances") {
    return sendJson(res, 200, { attendances: getScopedAttendances(db, actor, query).map((row) => enrichAttendance(db, row)).sort((a, b) => b.date.localeCompare(a.date)) });
  }

  if (method === "POST" && pathname === "/api/attendances/check-in") {
    const body = await parseBody(req);
    const current = nowParts();
    const user = actor;
    const existing = db.attendances.find((row) => row.userId === user.id && row.date === current.date);
    if (existing?.clockIn) {
      const error = new Error("Anda sudah check-in hari ini.");
      error.status = 409;
      throw error;
    }
    const shift = getShiftForUser(db, user.id, current.date);
    if (!shift) {
      const error = new Error("Shift belum diatur.");
      error.status = 400;
      throw error;
    }
    const mode = body.mode === "wfh" ? "wfh" : "onsite";
    const branch = db.branches.find((item) => item.id === user.branchId);
    let withinGeofence = true;
    let distanceMeters = 0;
    let lat = Number(body.lat);
    let lng = Number(body.lng);
    if (mode === "wfh") {
      if (db.settings.workFromHomeRequiresApproval && !hasApprovedWfhOrExternal(db, user.id, current.date)) {
        const error = new Error("Mode WFH/Dinas Luar membutuhkan izin yang sudah disetujui.");
        error.status = 403;
        throw error;
      }
    } else {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const error = new Error("Koordinat GPS wajib diisi untuk absensi onsite.");
        error.status = 400;
        throw error;
      }
      distanceMeters = haversineMeters(lat, lng, branch.lat, branch.lng);
      withinGeofence = distanceMeters <= Number(branch.radiusMeters || db.settings.geofenceDefaultRadiusMeters);
      if (!withinGeofence) {
        const error = new Error(`Lokasi di luar radius cabang. Jarak Anda ${distanceMeters} meter dari ${branch.name}.`);
        error.status = 403;
        throw error;
      }
    }
    const lateMinutes = Math.max(current.minutes - (minutesFromTime(shift.startTime) + Number(shift.toleranceMinutes || 0)), 0);
    const attendance = {
      id: nextId(db, "attendances"),
      userId: user.id,
      date: current.date,
      clockIn: isoNow(),
      clockOut: null,
      clockInLocalTime: current.time,
      clockOutLocalTime: null,
      latIn: mode === "wfh" ? null : lat,
      lngIn: mode === "wfh" ? null : lng,
      latOut: null,
      lngOut: null,
      branchId: user.branchId,
      status: lateMinutes > 0 ? "Terlambat" : "Hadir",
      lateMinutes,
      earlyLeaveMinutes: 0,
      workMinutes: 0,
      withinGeofence,
      distanceMeters,
      wfh: mode === "wfh",
      clockInPhoto: typeof body.photoDataUrl === "string" && body.photoDataUrl.startsWith("data:image/") ? body.photoDataUrl.slice(0, 250000) : "",
      clockOutPhoto: "",
      notes: sanitizeText(body.notes, 250),
      correctionLog: []
    };
    db.attendances.push(attendance);
    addAudit(db, user.id, "CLOCK_IN", "attendance", attendance.id, `${user.name} check-in ${attendance.status}.`);
    saveDb(db);
    return sendJson(res, 201, { attendance: enrichAttendance(db, attendance), message: "Check-in berhasil." });
  }

  if (method === "POST" && pathname === "/api/attendances/check-out") {
    const body = await parseBody(req);
    const current = nowParts();
    const user = actor;
    const attendance = db.attendances.find((row) => row.userId === user.id && row.date === current.date);
    if (!attendance?.clockIn) {
      const error = new Error("Belum ada check-in hari ini.");
      error.status = 409;
      throw error;
    }
    if (attendance.clockOut) {
      const error = new Error("Anda sudah check-out hari ini.");
      error.status = 409;
      throw error;
    }
    const branch = db.branches.find((item) => item.id === user.branchId);
    const mode = attendance.wfh ? "wfh" : "onsite";
    let lat = Number(body.lat);
    let lng = Number(body.lng);
    let withinGeofence = true;
    let distanceMeters = attendance.distanceMeters || 0;
    if (mode === "onsite") {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        const error = new Error("Koordinat GPS wajib diisi untuk check-out onsite.");
        error.status = 400;
        throw error;
      }
      distanceMeters = haversineMeters(lat, lng, branch.lat, branch.lng);
      withinGeofence = distanceMeters <= Number(branch.radiusMeters || db.settings.geofenceDefaultRadiusMeters);
      if (!withinGeofence) {
        const error = new Error(`Check-out di luar radius cabang. Jarak Anda ${distanceMeters} meter dari ${branch.name}.`);
        error.status = 403;
        throw error;
      }
    }
    const shift = getShiftForUser(db, user.id, current.date);
    const endMinutes = minutesFromTime(shift.endTime);
    const startMinutes = minutesFromTime(shift.startTime);
    const normalizedCurrent = endMinutes < startMinutes && current.minutes < startMinutes ? current.minutes + 24 * 60 : current.minutes;
    const normalizedEnd = endMinutes < startMinutes ? endMinutes + 24 * 60 : endMinutes;
    const earlyLeaveMinutes = Math.max(normalizedEnd - normalizedCurrent, 0);
    const clockInLocal = minutesFromTime(attendance.clockInLocalTime);
    const workMinutes = Math.max(normalizedCurrent - clockInLocal - Number(shift.breakMinutes || 0), 0);
    attendance.clockOut = isoNow();
    attendance.clockOutLocalTime = current.time;
    attendance.latOut = mode === "wfh" ? null : lat;
    attendance.lngOut = mode === "wfh" ? null : lng;
    attendance.earlyLeaveMinutes = earlyLeaveMinutes;
    attendance.workMinutes = workMinutes;
    attendance.clockOutPhoto = typeof body.photoDataUrl === "string" && body.photoDataUrl.startsWith("data:image/") ? body.photoDataUrl.slice(0, 250000) : "";
    attendance.withinGeofence = attendance.withinGeofence && withinGeofence;
    attendance.distanceMeters = Math.max(distanceMeters, attendance.distanceMeters || 0);
    addAudit(db, user.id, "CLOCK_OUT", "attendance", attendance.id, `${user.name} check-out. Jam kerja ${Math.round((workMinutes / 60) * 100) / 100} jam.`);
    saveDb(db);
    return sendJson(res, 200, { attendance: enrichAttendance(db, attendance), message: "Check-out berhasil." });
  }

  if (method === "PATCH" && pathname.startsWith("/api/attendances/")) {
    const id = Number(pathname.split("/").pop());
    const attendance = db.attendances.find((row) => row.id === id);
    if (!attendance || !isPrivileged(actor)) {
      const error = new Error("Hanya HRD/Super Admin yang dapat koreksi absensi.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    const before = jsonClone(attendance);
    if (body.status) attendance.status = sanitizeText(body.status, 40);
    if (body.clockInLocalTime) attendance.clockInLocalTime = sanitizeText(body.clockInLocalTime, 20);
    if (body.clockOutLocalTime) attendance.clockOutLocalTime = sanitizeText(body.clockOutLocalTime, 20);
    if (body.notes !== undefined) attendance.notes = sanitizeText(body.notes, 250);
    attendance.correctionLog = attendance.correctionLog || [];
    attendance.correctionLog.unshift({
      by: actor.id,
      at: isoNow(),
      reason: sanitizeText(body.reason || "Koreksi manual", 250),
      before
    });
    addAudit(db, actor.id, "ATTENDANCE_CORRECTED", "attendance", attendance.id, body.reason || "Koreksi manual");
    saveDb(db);
    return sendJson(res, 200, { attendance: enrichAttendance(db, attendance), message: "Absensi dikoreksi dan audit log tersimpan." });
  }

  if (method === "GET" && pathname === "/api/leaves") {
    return sendJson(res, 200, { leaves: getLeaveRows(db, actor).map((leave) => enrichLeave(db, leave)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }

  if (method === "POST" && pathname === "/api/leaves") {
    const body = await parseBody(req);
    requireFields(body, ["type", "startDate", "endDate", "reason"]);
    const targetUser = isPrivileged(actor) && body.userId ? db.users.find((user) => user.id === Number(body.userId)) : actor;
    if (!targetUser) {
      const error = new Error("Karyawan tidak ditemukan.");
      error.status = 404;
      throw error;
    }
    const days = countBusinessDays(db, body.startDate, body.endDate);
    if (days <= 0) {
      const error = new Error("Rentang tanggal tidak memiliki hari kerja.");
      error.status = 400;
      throw error;
    }
    if (body.type === "Cuti Tahunan" && Number(targetUser.leaveBalance || 0) < days) {
      const error = new Error("Saldo cuti tidak mencukupi.");
      error.status = 400;
      throw error;
    }
    const leave = {
      id: nextId(db, "leaves"),
      userId: targetUser.id,
      type: sanitizeText(body.type, 60),
      startDate: sanitizeText(body.startDate, 20),
      endDate: sanitizeText(body.endDate, 20),
      days,
      reason: sanitizeText(body.reason, 500),
      attachmentName: sanitizeText(body.attachmentName, 160),
      status: "Menunggu Manager",
      currentStep: "manager",
      managerApproverId: targetUser.managerId,
      hrApproverId: null,
      history: [{ by: actor.id, action: "Diajukan", comment: "", at: isoNow() }],
      createdAt: isoNow(),
      updatedAt: isoNow()
    };
    if (!targetUser.managerId) {
      leave.status = "Menunggu HRD";
      leave.currentStep = "hrd";
    }
    db.leaves.push(leave);
    addNotification(db, leave.managerApproverId || db.users.find((user) => user.role === "hrd_admin")?.id, "Pengajuan izin/cuti baru", `${targetUser.name} mengajukan ${leave.type}.`);
    addAudit(db, actor.id, "LEAVE_CREATED", "leave", leave.id, `${targetUser.name} mengajukan ${leave.type}.`);
    saveDb(db);
    return sendJson(res, 201, { leave: enrichLeave(db, leave), message: "Pengajuan berhasil dikirim." });
  }

  if (method === "PATCH" && pathname.startsWith("/api/leaves/")) {
    const id = Number(pathname.split("/").pop());
    const leave = db.leaves.find((row) => row.id === id);
    if (!canReviewLeave(actor, db, leave)) {
      const error = new Error("Anda tidak berwenang meninjau pengajuan ini.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    const decision = body.decision === "reject" ? "reject" : "approve";
    const employee = db.users.find((user) => user.id === leave.userId);
    if (decision === "reject") {
      leave.status = "Ditolak";
      leave.currentStep = "done";
      leave.history.push({ by: actor.id, action: "Ditolak", comment: sanitizeText(body.comment, 250), at: isoNow() });
      addNotification(db, leave.userId, "Pengajuan ditolak", `${leave.type} Anda ditolak. ${sanitizeText(body.comment, 120)}`);
      addAudit(db, actor.id, "LEAVE_REJECTED", "leave", leave.id, body.comment || "Ditolak");
    } else if (leave.currentStep === "manager") {
      leave.status = "Menunggu HRD";
      leave.currentStep = "hrd";
      leave.managerApproverId = actor.id;
      leave.history.push({ by: actor.id, action: "Disetujui Manager", comment: sanitizeText(body.comment, 250), at: isoNow() });
      db.users.filter((user) => user.role === "hrd_admin").forEach((hr) => addNotification(db, hr.id, "Approval HRD dibutuhkan", `${employee?.name || "Karyawan"} menunggu approval HRD.`));
      addAudit(db, actor.id, "LEAVE_MANAGER_APPROVED", "leave", leave.id, body.comment || "Disetujui Manager");
    } else {
      leave.status = "Disetujui";
      leave.currentStep = "done";
      leave.hrApproverId = actor.id;
      leave.history.push({ by: actor.id, action: "Disetujui HRD", comment: sanitizeText(body.comment, 250), at: isoNow() });
      if (leave.type === "Cuti Tahunan" && employee) employee.leaveBalance = Math.max(Number(employee.leaveBalance || 0) - Number(leave.days || 0), 0);
      addNotification(db, leave.userId, "Pengajuan disetujui", `${leave.type} Anda sudah disetujui.`);
      addAudit(db, actor.id, "LEAVE_HRD_APPROVED", "leave", leave.id, body.comment || "Disetujui HRD");
    }
    leave.updatedAt = isoNow();
    saveDb(db);
    return sendJson(res, 200, { leave: enrichLeave(db, leave), message: "Status pengajuan diperbarui." });
  }

  if (method === "GET" && pathname === "/api/overtimes") {
    return sendJson(res, 200, { overtimes: getOvertimeRows(db, actor).map((overtime) => enrichOvertime(db, overtime)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  }

  if (method === "POST" && pathname === "/api/overtimes") {
    const body = await parseBody(req);
    requireFields(body, ["date", "startTime", "endTime", "reason"]);
    const targetUser = isPrivileged(actor) && body.userId ? db.users.find((user) => user.id === Number(body.userId)) : actor;
    const hours = timeDiffHours(body.startTime, body.endTime);
    if (hours <= 0 || hours > Number(db.settings.maxOvertimeHoursPerDay || 4)) {
      const error = new Error(`Jam lembur harus 0-${db.settings.maxOvertimeHoursPerDay} jam per hari.`);
      error.status = 400;
      throw error;
    }
    const weekStart = new Date(`${body.date}T00:00:00Z`);
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay() + 1);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
    const weeklyHours = db.overtimes
      .filter((item) => item.userId === targetUser.id && item.status !== "Ditolak" && item.date >= weekStart.toISOString().slice(0, 10) && item.date <= weekEnd.toISOString().slice(0, 10))
      .reduce((sum, item) => sum + Number(item.hours || 0), 0);
    if (weeklyHours + hours > Number(db.settings.maxOvertimeHoursPerWeek || 18)) {
      const error = new Error(`Total lembur mingguan melebihi ${db.settings.maxOvertimeHoursPerWeek} jam.`);
      error.status = 400;
      throw error;
    }
    const overtime = {
      id: nextId(db, "overtimes"),
      userId: targetUser.id,
      date: sanitizeText(body.date, 20),
      startTime: sanitizeText(body.startTime, 20),
      endTime: sanitizeText(body.endTime, 20),
      hours,
      reason: sanitizeText(body.reason, 500),
      status: "Menunggu Manager",
      approverId: targetUser.managerId,
      costEstimate: Math.round(hours * Number(db.settings.overtimeRatePerHour || 0)),
      history: [{ by: actor.id, action: "Diajukan", comment: "", at: isoNow() }],
      createdAt: isoNow(),
      updatedAt: isoNow()
    };
    db.overtimes.push(overtime);
    addNotification(db, overtime.approverId, "Pengajuan lembur baru", `${targetUser.name} mengajukan lembur ${hours} jam.`);
    addAudit(db, actor.id, "OVERTIME_CREATED", "overtime", overtime.id, `${targetUser.name} mengajukan ${hours} jam.`);
    saveDb(db);
    return sendJson(res, 201, { overtime: enrichOvertime(db, overtime), message: "Pengajuan lembur berhasil dikirim." });
  }

  if (method === "PATCH" && pathname.startsWith("/api/overtimes/")) {
    const id = Number(pathname.split("/").pop());
    const overtime = db.overtimes.find((row) => row.id === id);
    if (!canReviewOvertime(actor, overtime)) {
      const error = new Error("Anda tidak berwenang meninjau lembur ini.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    const approved = body.decision !== "reject";
    overtime.status = approved ? "Disetujui" : "Ditolak";
    overtime.history.push({ by: actor.id, action: overtime.status, comment: sanitizeText(body.comment, 250), at: isoNow() });
    overtime.updatedAt = isoNow();
    addNotification(db, overtime.userId, `Lembur ${overtime.status.toLowerCase()}`, `Pengajuan lembur ${overtime.date} ${overtime.status.toLowerCase()}.`);
    addAudit(db, actor.id, approved ? "OVERTIME_APPROVED" : "OVERTIME_REJECTED", "overtime", overtime.id, body.comment || overtime.status);
    saveDb(db);
    return sendJson(res, 200, { overtime: enrichOvertime(db, overtime), message: "Status lembur diperbarui." });
  }

  if (method === "GET" && pathname === "/api/shifts") {
    return sendJson(res, 200, { shifts: db.shifts, schedules: db.shiftSchedules });
  }

  if (method === "POST" && pathname === "/api/shifts") {
    if (!isPrivileged(actor)) {
      const error = new Error("Hanya HRD/Super Admin yang dapat membuat shift.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    requireFields(body, ["name", "startTime", "endTime"]);
    const shift = {
      id: nextId(db, "shifts"),
      name: sanitizeText(body.name, 80),
      startTime: sanitizeText(body.startTime, 20),
      endTime: sanitizeText(body.endTime, 20),
      toleranceMinutes: Number(body.toleranceMinutes || 0),
      breakMinutes: Number(body.breakMinutes || 0)
    };
    db.shifts.push(shift);
    addAudit(db, actor.id, "SHIFT_CREATED", "shift", shift.id, shift.name);
    saveDb(db);
    return sendJson(res, 201, { shift, message: "Shift berhasil dibuat." });
  }

  if (method === "POST" && pathname === "/api/shift-schedules") {
    if (!isPrivileged(actor)) {
      const error = new Error("Hanya HRD/Super Admin yang dapat mengatur jadwal shift.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    requireFields(body, ["userId", "date", "shiftId"]);
    const existing = db.shiftSchedules.find((item) => item.userId === Number(body.userId) && item.date === body.date);
    if (existing) existing.shiftId = Number(body.shiftId);
    else db.shiftSchedules.push({ id: nextId(db, "shiftSchedules"), userId: Number(body.userId), date: sanitizeText(body.date, 20), shiftId: Number(body.shiftId) });
    addAudit(db, actor.id, "SHIFT_ASSIGNED", "shiftSchedule", body.userId, `${body.date} -> shift ${body.shiftId}`);
    saveDb(db);
    return sendJson(res, 200, { schedules: db.shiftSchedules, message: "Jadwal shift diperbarui." });
  }

  if (method === "GET" && pathname === "/api/reports/summary") {
    return sendJson(res, 200, { rows: buildAttendanceSummary(db, actor, query), from: query.from, to: query.to });
  }

  if (method === "GET" && pathname === "/api/reports/export.xlsx") {
    const rows = buildReportRows(db, actor, query);
    const file = createXlsx(rows);
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="rekap-absensi-${query.from || nowParts().date}.xlsx"`,
      "Cache-Control": "no-store"
    });
    return res.end(file);
  }

  if (method === "GET" && pathname === "/api/reports/export.pdf") {
    const rows = buildReportRows(db, actor, query);
    const lines = [
      `Periode: ${query.from || "-"} s/d ${query.to || "-"}`,
      `Dibuat: ${new Date().toLocaleString("id-ID", { timeZone: TZ })}`,
      "",
      ...rows.map((row) => `${row.No}. ${row.Nama} (${row.NIK}) | Hadir ${row.Hadir} | Terlambat ${row.Terlambat} | Alpha ${row.Alpha} | Lembur ${row["Jam Lembur"]} jam | Rp${row["Biaya Lembur"]}`)
    ];
    const pdf = createSimplePdf("Rekap Absensi Karyawan", lines);
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="rekap-absensi-${query.from || nowParts().date}.pdf"`,
      "Cache-Control": "no-store"
    });
    return res.end(pdf);
  }

  if (method === "GET" && pathname === "/api/notifications") {
    const notifications = db.notifications.filter((item) => item.userId === actor.id || actor.role === "super_admin").slice(0, 100);
    return sendJson(res, 200, { notifications });
  }

  if (method === "POST" && pathname === "/api/notifications/read") {
    db.notifications.filter((item) => item.userId === actor.id).forEach((item) => {
      item.read = true;
    });
    saveDb(db);
    return sendJson(res, 200, { message: "Notifikasi ditandai sudah dibaca." });
  }

  if (method === "POST" && pathname === "/api/announcements") {
    if (!isPrivileged(actor)) {
      const error = new Error("Hanya HRD/Super Admin yang dapat membuat pengumuman.");
      error.status = 403;
      throw error;
    }
    const body = await parseBody(req);
    requireFields(body, ["title", "body"]);
    const announcement = {
      id: nextId(db, "announcements"),
      title: sanitizeText(body.title, 120),
      body: sanitizeText(body.body, 600),
      audience: sanitizeText(body.audience || "all", 40),
      createdBy: actor.id,
      createdAt: isoNow()
    };
    db.announcements.unshift(announcement);
    db.users.forEach((user) => {
      if (announcement.audience === "all" || announcement.audience === user.role) {
        addNotification(db, user.id, `Pengumuman: ${announcement.title}`, announcement.body);
      }
    });
    addAudit(db, actor.id, "ANNOUNCEMENT_CREATED", "announcement", announcement.id, announcement.title);
    saveDb(db);
    return sendJson(res, 201, { announcement, message: "Pengumuman dikirim." });
  }

  if (method === "GET" && pathname === "/api/audit-logs") {
    if (!isPrivileged(actor)) {
      const error = new Error("Hanya HRD/Super Admin yang dapat melihat audit log.");
      error.status = 403;
      throw error;
    }
    return sendJson(res, 200, {
      auditLogs: db.auditLogs.slice(0, 250).map((log) => ({
        ...log,
        actorName: db.users.find((user) => user.id === log.actorId)?.name || "System"
      }))
    });
  }

  const error = new Error("Endpoint tidak ditemukan.");
  error.status = 404;
  throw error;
}

function serveStatic(req, res, url) {
  const pathname = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const requested = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!requested.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(requested, (err, content) => {
    if (err) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (indexErr, indexContent) => {
        if (indexErr) {
          res.writeHead(404);
          return res.end("Not found");
        }
        res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
        res.end(indexContent);
      });
      return;
    }
    const ext = path.extname(requested).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    res.end(content);
  });
}

async function listener(req, res) {
  try {
    checkRateLimit(req);
    const db = loadDb();
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, db, url);
    return serveStatic(req, res, url);
  } catch (error) {
    return sendError(res, error);
  }
}

if (process.argv.includes("--seed-only")) {
  const db = seedDatabase();
  ensureDir(DATA_DIR);
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  console.log(`Seed database ditulis ke ${DB_FILE}`);
} else {
  ensureDir(DATA_DIR);
  ensureDir(PUBLIC_DIR);
  const server = http.createServer(listener);
  server.listen(PORT, () => {
    console.log(`Aplikasi absensi berjalan di http://localhost:${PORT}`);
    console.log("Akun demo: super@company.test / password123");
  });
}
