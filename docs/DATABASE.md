# Struktur Data

Database demo tersimpan di `data/db.json`. Struktur ini sengaja dekat dengan skema SQL agar mudah dimigrasikan ke PostgreSQL atau MySQL.

## Tabel utama

- `users`: akun dan profil karyawan.
- `attendances`: clock in/out, GPS, status, selfie, dan koreksi.
- `leaves`: izin, cuti, sakit, WFH, dinas luar, status approval.
- `overtimes`: pengajuan lembur, jam, status, estimasi biaya.
- `shifts`: master shift.
- `shiftSchedules`: jadwal shift khusus per tanggal.
- `holidays`: tanggal merah nasional atau perusahaan.
- `branches`: lokasi kantor dan radius geofence.
- `departments`: departemen/divisi.
- `notifications`: notifikasi in-app.
- `announcements`: pengumuman HRD.
- `auditLogs`: log aktivitas penting dan koreksi.

## Mapping ke SQL

Relasi yang disarankan:

- `users.department_id -> departments.id`
- `users.branch_id -> branches.id`
- `users.shift_id -> shifts.id`
- `users.manager_id -> users.id`
- `attendances.user_id -> users.id`
- `attendances.branch_id -> branches.id`
- `leaves.user_id -> users.id`
- `leaves.manager_approver_id -> users.id`
- `leaves.hr_approver_id -> users.id`
- `overtimes.user_id -> users.id`
- `overtimes.approver_id -> users.id`
- `shift_schedules.user_id -> users.id`
- `shift_schedules.shift_id -> shifts.id`

## Endpoint API ringkas

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/dashboard`
- `GET /api/master-data`
- `GET /api/employees`
- `POST /api/employees`
- `POST /api/employees/import`
- `POST /api/attendances/check-in`
- `POST /api/attendances/check-out`
- `PATCH /api/attendances/:id`
- `GET /api/leaves`
- `POST /api/leaves`
- `PATCH /api/leaves/:id`
- `GET /api/overtimes`
- `POST /api/overtimes`
- `PATCH /api/overtimes/:id`
- `GET /api/shifts`
- `POST /api/shifts`
- `POST /api/shift-schedules`
- `GET /api/reports/summary`
- `GET /api/reports/export.xlsx`
- `GET /api/reports/export.pdf`
- `GET /api/notifications`
- `POST /api/notifications/read`
- `POST /api/announcements`
- `GET /api/audit-logs`
