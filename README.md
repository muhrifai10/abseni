# Aplikasi Absensi Karyawan

Web app absensi karyawan responsif dengan backend Node.js tanpa dependency eksternal. Aplikasi ini dibuat untuk demo lokal yang bisa langsung dijalankan, tetapi struktur API, data model, dan workflow-nya disusun agar mudah dikembangkan menjadi sistem produksi.

## Fitur yang tersedia

- Auth token HMAC dengan access token dan refresh token.
- Role: Super Admin, HRD/Admin, Manajer, Karyawan.
- Clock in dan clock out dengan timestamp server-side.
- Validasi geofence per cabang, jarak radius, dan mode WFH/Dinas Luar berbasis izin disetujui.
- Deteksi terlambat, pulang lebih awal, durasi kerja, dan status absensi.
- Upload selfie opsional saat absen.
- Manajemen izin, cuti, sakit, WFH, dan dinas luar dengan approval Manager -> HRD.
- Saldo cuti tahunan otomatis berkurang setelah approval HRD.
- Pengajuan lembur dengan kalkulasi jam, batas harian/mingguan, dan estimasi biaya payroll.
- Manajemen karyawan, tambah karyawan, dan import CSV.
- Manajemen shift dan assign jadwal shift harian.
- Dashboard real-time, tren kehadiran, rekap payroll, export XLSX dan PDF.
- Notifikasi internal, pengumuman HRD, audit log, rate limiting, dan validasi input.

## Cara menjalankan

Jika `node` tersedia di PATH:

```powershell
node server.js
```

Di lingkungan Codex ini, gunakan Node runtime terbundel:

```powershell
& 'C:\Users\muham\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js
```

Lalu buka:

```text
http://localhost:5173
```

Untuk reset data demo:

```powershell
& 'C:\Users\muham\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' server.js --seed-only
```

## Akun demo

Semua akun menggunakan password:

```text
password123
```

| Role | Email |
| --- | --- |
| Super Admin | super@company.test |
| HRD / Admin | hrd@company.test |
| Manajer | manager@company.test |
| Karyawan | karyawan@company.test |

## Import CSV karyawan

Format header:

```csv
nik,nama,email,role,department_id,branch_id,shift_id,manager_id,jabatan
EMP-009,Nadia,nadia@company.test,employee,3,1,1,3,QA Engineer
```

## Catatan produksi

- Ganti `ACCESS_TOKEN_SECRET` dan `REFRESH_TOKEN_SECRET` memakai environment variable.
- Pindahkan `data/db.json` ke PostgreSQL/MySQL untuk multi-user production.
- Simpan selfie dan lampiran ke S3/Cloudinary, lalu simpan URL di database.
- Hubungkan push notification ke Firebase Cloud Messaging.
- Hubungkan peta ke Google Maps atau Mapbox dengan API key resmi.
- Tambahkan HTTPS, password policy, reset password, RBAC granular, backup, observability, dan job scheduler untuk alpha/reminder otomatis.
