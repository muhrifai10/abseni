
(function () {
  const app = document.querySelector("#app");
  const toastRoot = document.querySelector("#toast");
  const storage = window.localStorage;
  const state = {
    accessToken: storage.getItem("attendance.accessToken") || "",
    refreshToken: storage.getItem("attendance.refreshToken") || "",
    theme: storage.getItem("attendance.theme") || "",
    user: null,
    config: null,
    master: null,
    route: "dashboard",
    loading: false,
    data: {},
    reportFilters: {},
    selfie: ""
  };

  if (!state.theme) {
    state.theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyTheme() {
    document.documentElement.dataset.theme = state.theme;
  }

  function themeLabel() {
    return state.theme === "dark" ? "Tema terang" : "Tema gelap";
  }

  applyTheme();

  const roleLabels = {
    super_admin: "Super Admin",
    hrd_admin: "HRD / Admin",
    manager: "Manajer",
    employee: "Karyawan"
  };

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "▦", roles: ["super_admin", "hrd_admin", "manager", "employee"] },
    { id: "attendance", label: "Absensi", icon: "◷", roles: ["super_admin", "hrd_admin", "manager", "employee"] },
    { id: "leaves", label: "Izin & Cuti", icon: "□", roles: ["super_admin", "hrd_admin", "manager", "employee"] },
    { id: "overtime", label: "Lembur", icon: "＋", roles: ["super_admin", "hrd_admin", "manager", "employee"] },
    { id: "employees", label: "Karyawan", icon: "☷", roles: ["super_admin", "hrd_admin", "manager"] },
    { id: "shifts", label: "Shift", icon: "↻", roles: ["super_admin", "hrd_admin", "manager"] },
    { id: "reports", label: "Laporan", icon: "▤", roles: ["super_admin", "hrd_admin", "manager"] },
    { id: "notifications", label: "Notifikasi", icon: "✉", roles: ["super_admin", "hrd_admin", "manager", "employee"] },
    { id: "audit", label: "Audit", icon: "⌁", roles: ["super_admin", "hrd_admin"] }
  ];

  function can(route) {
    const item = navItems.find((nav) => nav.id === route);
    return item && state.user && item.roles.includes(state.user.role);
  }

  function adminish() {
    return state.user && ["super_admin", "hrd_admin"].includes(state.user.role);
  }

  function managerish() {
    return state.user && ["super_admin", "hrd_admin", "manager"].includes(state.user.role);
  }

  function today() {
    return state.config?.serverDate?.date || new Date().toISOString().slice(0, 10);
  }

  function firstDayOfMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function rupiah(value) {
    return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  function formatDate(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00`));
  }

  function formatDateTime(value) {
    if (!value) return "-";
    return new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  }

  function statusClass(status) {
    if (["Hadir", "Disetujui", "Aktif"].includes(status)) return "ok";
    if (["Terlambat", "Menunggu Manager", "Menunggu HRD"].includes(status)) return "warn";
    if (["Alpha", "Ditolak", "Sakit"].includes(status)) return "danger";
    return "";
  }

  function showToast(message, type = "info") {
    const item = document.createElement("div");
    item.className = `toast-item ${type === "error" ? "error" : ""}`;
    item.textContent = message;
    toastRoot.appendChild(item);
    setTimeout(() => item.remove(), 3800);
  }

  async function apiJson(path, options = {}, retry = true) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body !== undefined) headers.set("Content-Type", "application/json");
    if (state.accessToken) headers.set("Authorization", `Bearer ${state.accessToken}`);
    const response = await fetch(path, {
      ...options,
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined
    });
    if (response.status === 401 && retry && state.refreshToken) {
      const refreshed = await refreshSession();
      if (refreshed) return apiJson(path, options, false);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Request gagal.");
    return data;
  }

  async function apiBlob(path) {
    const headers = new Headers();
    if (state.accessToken) headers.set("Authorization", `Bearer ${state.accessToken}`);
    const response = await fetch(path, { headers });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Download gagal.");
    }
    return response.blob();
  }

  async function refreshSession() {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: state.refreshToken })
      });
      if (!response.ok) return false;
      const data = await response.json();
      setSession(data);
      return true;
    } catch {
      return false;
    }
  }

  function setSession(data) {
    state.accessToken = data.accessToken;
    state.refreshToken = data.refreshToken;
    state.user = data.user;
    storage.setItem("attendance.accessToken", data.accessToken);
    storage.setItem("attendance.refreshToken", data.refreshToken);
  }

  function clearSession() {
    state.accessToken = "";
    state.refreshToken = "";
    state.user = null;
    state.data = {};
    storage.removeItem("attendance.accessToken");
    storage.removeItem("attendance.refreshToken");
  }

  function initials(name) {
    return String(name || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function optionRows(items, selectedId, label = "name") {
    return (items || [])
      .map((item) => `<option value="${item.id}" ${Number(selectedId) === item.id ? "selected" : ""}>${escapeHtml(item[label])}</option>`)
      .join("");
  }

  async function ensureMaster() {
    if (!state.master && state.user) state.master = await apiJson("/api/master-data");
  }

  async function loadRouteData(route = state.route) {
    if (!state.user) return;
    state.loading = true;
    render();
    try {
      await ensureMaster();
      if (route === "dashboard") state.data.dashboard = await apiJson("/api/dashboard");
      if (route === "attendance") state.data.attendance = await apiJson(`/api/attendances?from=${firstDayOfMonth()}&to=${today()}`);
      if (route === "leaves") {
        state.data.leaves = await apiJson("/api/leaves");
        if (managerish()) state.data.employees = await apiJson("/api/employees");
      }
      if (route === "overtime") {
        state.data.overtimes = await apiJson("/api/overtimes");
        if (managerish()) state.data.employees = await apiJson("/api/employees");
      }
      if (route === "employees") state.data.employees = await apiJson("/api/employees");
      if (route === "shifts") {
        state.data.shifts = await apiJson("/api/shifts");
        state.data.employees = await apiJson("/api/employees");
      }
      if (route === "reports") {
        const filters = {
          from: state.reportFilters.from || firstDayOfMonth(),
          to: state.reportFilters.to || today(),
          departmentId: state.reportFilters.departmentId || "",
          userId: state.reportFilters.userId || ""
        };
        const query = new URLSearchParams(filters);
        state.data.reports = await apiJson(`/api/reports/summary?${query}`);
        state.data.employees = await apiJson("/api/employees");
      }
      if (route === "notifications") state.data.notifications = await apiJson("/api/notifications");
      if (route === "audit") state.data.audit = await apiJson("/api/audit-logs");
    } catch (error) {
      showToast(error.message, "error");
      if (error.message.includes("Sesi")) clearSession();
    } finally {
      state.loading = false;
      render();
    }
  }

  function renderLogin() {
    const accounts = state.config?.demoAccounts || [];
    app.innerHTML = `
      <section class="login-page">
        <div class="login-hero">
          <div>
            <div class="brand-mark"><span>✓</span> Nusantara Attendance</div>
            <h1>Absensi digital real-time untuk tim modern.</h1>
            <p>Kelola check-in, geofence, shift, izin, cuti, lembur, laporan payroll, notifikasi, dan audit dalam satu web app responsif.</p>
          </div>
          <div class="hero-metrics">
            <div class="hero-metric"><strong>4</strong><span>Role akses</span></div>
            <div class="hero-metric"><strong>100m</strong><span>Radius geofence demo</span></div>
            <div class="hero-metric"><strong>XLSX</strong><span>Export laporan payroll</span></div>
          </div>
        </div>
        <div class="login-panel">
          <div class="login-box">
            <p class="eyebrow">Masuk aplikasi</p>
            <h2>Dashboard absensi</h2>
            <p>Pilih akun demo atau login manual. Semua akun demo memakai password <span class="kbd">password123</span>.</p>
            <form id="login-form" class="form-grid">
              <label class="field">
                <span>Email</span>
                <input class="input" name="email" value="super@company.test" autocomplete="username" required />
              </label>
              <label class="field">
                <span>Password</span>
                <input class="input" name="password" type="password" value="password123" autocomplete="current-password" required />
              </label>
              <button class="btn primary" type="submit">Masuk</button>
            </form>
            <button class="btn ghost theme-toggle" style="margin-top:14px; width:100%" data-action="toggle-theme">${themeLabel()}</button>
            <div class="demo-grid">
              ${accounts
                .map(
                  (account) => `<button class="btn ghost small" data-action="demo-login" data-email="${escapeHtml(account.email)}">${escapeHtml(account.role)}</button>`
                )
                .join("")}
            </div>
          </div>
        </div>
      </section>
    `;
  }

  function renderShell() {
    const visibleNav = navItems.filter((item) => item.roles.includes(state.user.role));
    const activeLabel = navItems.find((item) => item.id === state.route)?.label || "Dashboard";
    app.innerHTML = `
      <section class="app-shell">
        <aside class="sidebar">
          <div class="brand-mark"><span>✓</span> <strong>Nusantara Attendance</strong></div>
          <nav class="nav">
            ${visibleNav
              .map(
                (item) => `<button class="${state.route === item.id ? "active" : ""}" data-action="navigate" data-route="${item.id}"><span>${item.icon}</span>${item.label}</button>`
              )
              .join("")}
          </nav>
          <select class="select mobile-nav" data-action="mobile-nav">
            ${visibleNav.map((item) => `<option value="${item.id}" ${state.route === item.id ? "selected" : ""}>${item.label}</option>`).join("")}
          </select>
          <div class="sidebar-footer">
            <div class="user-mini">
              <div class="avatar">${initials(state.user.name)}</div>
              <div>
                <strong class="truncate">${escapeHtml(state.user.name)}</strong>
                <div class="role-pill">${roleLabels[state.user.role]}</div>
              </div>
            </div>
            <button class="btn ghost" style="width:100%; margin-top:14px" data-action="logout">Keluar</button>
          </div>
        </aside>
        <section class="content">
          <header class="topbar">
            <div>
              <h1>${escapeHtml(activeLabel)}</h1>
              <p>${escapeHtml(state.user.department || "-")} · ${escapeHtml(state.user.branch || "-")}</p>
            </div>
            <div class="actions">
              <span class="chip">${formatDate(today())}</span>
              <span class="role-pill">${roleLabels[state.user.role]}</span>
              <button class="btn ghost small theme-toggle" data-action="toggle-theme">${themeLabel()}</button>
              <button class="btn ghost small" data-action="logout">Keluar</button>
            </div>
          </header>
          <div class="page">
            ${state.loading ? `<div class="empty">Memuat data...</div>` : renderPage()}
          </div>
        </section>
      </section>
    `;
  }

  function renderPage() {
    if (!can(state.route)) return `<div class="empty">Role Anda tidak punya akses ke halaman ini.</div>`;
    if (state.route === "dashboard") return renderDashboard();
    if (state.route === "attendance") return renderAttendance();
    if (state.route === "leaves") return renderLeaves();
    if (state.route === "overtime") return renderOvertime();
    if (state.route === "employees") return renderEmployees();
    if (state.route === "shifts") return renderShifts();
    if (state.route === "reports") return renderReports();
    if (state.route === "notifications") return renderNotifications();
    if (state.route === "audit") return renderAudit();
    return `<div class="empty">Halaman belum tersedia.</div>`;
  }

  function renderDashboard() {
    const data = state.data.dashboard;
    if (!data) return `<div class="empty">Dashboard siap dimuat.</div>`;
    const stats = data.stats;
    return `
      <section class="grid four">
        ${stat("Karyawan aktif", stats.employees, "Dalam cakupan role Anda")}
        ${stat("Hadir hari ini", stats.present, `${stats.late} terlambat`)}
        ${stat("Alpha", stats.alpha, "Belum tercatat hadir/cuti")}
        ${stat("Approval", stats.pendingLeaves + stats.pendingOvertimes, "Izin/cuti dan lembur")}
      </section>
      <section class="grid two">
        <div class="panel">
          <div class="panel-header">
            <div><h2>Tren kehadiran 7 hari</h2><p>Ringkas hadir dan terlambat per hari.</p></div>
          </div>
          ${renderTrend(data.trend)}
        </div>
        <div class="panel">
          <div class="panel-header">
            <div><h2>Pengumuman HRD</h2><p>Notifikasi internal untuk karyawan.</p></div>
          </div>
          ${data.announcements.map((item) => `<p><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.body)}</span></p>`).join("") || empty("Belum ada pengumuman.")}
        </div>
      </section>
      <section class="grid two">
        ${renderPendingLeaves(data.pendingLeaves)}
        ${renderPendingOvertimes(data.pendingOvertimes)}
      </section>
      ${renderAttendanceTable(data.todayAttendances, "Absensi hari ini")}
    `;
  }

  function stat(label, value, helper) {
    return `<div class="stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(helper)}</small></div>`;
  }

  function renderTrend(trend = []) {
    const max = Math.max(1, ...trend.map((item) => item.present + item.late));
    return `
      <div class="chart">
        ${trend
          .map((item) => {
            const height = Math.max(6, Math.round(((item.present + item.late) / max) * 100));
            return `<div class="bar"><div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div><small>${item.date.slice(5)}</small><strong>${item.present}</strong></div>`;
          })
          .join("")}
      </div>
    `;
  }

  function renderPendingLeaves(leaves = []) {
    return `
      <div class="panel">
        <div class="panel-header"><div><h2>Approval izin/cuti</h2><p>Alur Manager ke HRD.</p></div></div>
        ${
          leaves.length
            ? leaves
                .map(
                  (leave) => `<p><strong>${escapeHtml(leave.userName)}</strong> · ${escapeHtml(leave.type)}<br><span class="muted">${formatDate(leave.startDate)} - ${formatDate(leave.endDate)} · ${leave.status}</span>${reviewButtons("leave", leave.id)}</p>`
                )
                .join("")
            : empty("Tidak ada izin/cuti yang menunggu.")
        }
      </div>
    `;
  }

  function renderPendingOvertimes(overtimes = []) {
    return `
      <div class="panel">
        <div class="panel-header"><div><h2>Approval lembur</h2><p>Validasi batas harian dan mingguan.</p></div></div>
        ${
          overtimes.length
            ? overtimes
                .map(
                  (overtime) => `<p><strong>${escapeHtml(overtime.userName)}</strong> · ${overtime.hours} jam<br><span class="muted">${formatDate(overtime.date)} · estimasi ${rupiah(overtime.costEstimate)}</span>${reviewButtons("overtime", overtime.id)}</p>`
                )
                .join("")
            : empty("Tidak ada lembur yang menunggu.")
        }
      </div>
    `;
  }

  function reviewButtons(type, id) {
    if (!managerish()) return "";
    return `<span class="actions" style="margin-top:8px"><button class="btn primary small" data-action="review" data-type="${type}" data-id="${id}" data-decision="approve">Approve</button><button class="btn danger small" data-action="review" data-type="${type}" data-id="${id}" data-decision="reject">Tolak</button></span>`;
  }

  function renderAttendance() {
    const branch = state.master?.branches?.find((item) => item.id === state.user.branchId) || state.master?.branches?.[0] || {};
    const attendance = state.data.attendance?.attendances || [];
    const todayRow = attendance.find((row) => row.date === today() && row.userId === state.user.id);
    return `
      <section class="clock-box">
        <div class="panel">
          <div class="panel-header">
            <div><h2>Clock In & Clock Out</h2><p>Timestamp memakai server. GPS divalidasi terhadap radius cabang.</p></div>
            <span class="status ${statusClass(todayRow?.status)}">${todayRow?.status || "Belum absen"}</span>
          </div>
          <div class="grid two">
            <label class="field"><span>Mode kerja</span><select class="select" id="attendance-mode"><option value="onsite">Onsite</option><option value="wfh">WFH / Dinas luar</option></select></label>
            <label class="field"><span>Catatan</span><input class="input" id="attendance-notes" placeholder="Opsional" /></label>
            <label class="field"><span>Latitude</span><input class="input" id="attendance-lat" value="${branch.lat || ""}" /></label>
            <label class="field"><span>Longitude</span><input class="input" id="attendance-lng" value="${branch.lng || ""}" /></label>
          </div>
          <div class="actions" style="margin-top:14px">
            <button class="btn ghost" data-action="use-branch-location">Gunakan lokasi cabang</button>
            <button class="btn ghost" data-action="use-gps">Ambil GPS perangkat</button>
          </div>
          <div class="actions" style="margin-top:16px">
            <button class="btn primary" data-action="clock-in" ${todayRow?.clockIn ? "disabled" : ""}>Check In</button>
            <button class="btn warning" data-action="clock-out" ${!todayRow?.clockIn || todayRow?.clockOut ? "disabled" : ""}>Check Out</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Selfie absen</h2><p>Opsional untuk bukti foto.</p></div></div>
          <label class="field"><span>Upload foto</span><input class="input" type="file" accept="image/*" data-selfie /></label>
          <div class="selfie-preview" id="selfie-preview">${state.selfie ? `<img src="${state.selfie}" alt="Preview selfie" />` : "Preview selfie"}</div>
        </div>
      </section>
      <section class="grid three">
        ${stat("Shift", state.user.shift || "-", "Jadwal default karyawan")}
        ${stat("Cabang", state.user.branch || "-", `${branch.radiusMeters || 100}m radius`)}
        ${stat("Saldo cuti", `${state.user.leaveBalance ?? 0} hari`, "Berubah saat cuti tahunan disetujui")}
      </section>
      ${renderAttendanceTable(attendance, "Histori absensi bulan ini", adminish())}
    `;
  }

  function renderAttendanceTable(rows = [], title = "Absensi", allowCorrection = false) {
    return `
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>${escapeHtml(title)}</h2><p>Status hadir, terlambat, pulang awal, geofence, dan WFH.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Tanggal</th><th>Karyawan</th><th>Jam</th><th>Status</th><th>Lokasi</th><th>Catatan</th>${allowCorrection ? "<th>Aksi</th>" : ""}</tr></thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (row) => `<tr>
                          <td>${formatDate(row.date)}</td>
                          <td><strong>${escapeHtml(row.userName || state.user.name)}</strong><br><span class="muted">${escapeHtml(row.department || "")}</span></td>
                          <td>Masuk: ${escapeHtml(row.clockInLocalTime || "-")}<br>Pulang: ${escapeHtml(row.clockOutLocalTime || "-")}<br><span class="muted">${Math.round((row.workMinutes || 0) / 60 * 100) / 100} jam kerja</span></td>
                          <td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span><br><span class="muted">Telat ${row.lateMinutes || 0}m · Awal ${row.earlyLeaveMinutes || 0}m</span></td>
                          <td>${row.wfh ? "WFH/Dinas luar" : escapeHtml(row.branchName || "-")}<br><span class="muted">${row.withinGeofence ? "Dalam radius" : "Di luar radius"} · ${row.distanceMeters || 0}m</span></td>
                          <td>${escapeHtml(row.notes || "-")}</td>
                          ${allowCorrection ? `<td><button class="btn ghost small" data-action="correct-attendance" data-id="${row.id}">Koreksi</button></td>` : ""}
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="${allowCorrection ? 7 : 6}">${empty("Belum ada data absensi.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderLeaves() {
    const leaves = state.data.leaves?.leaves || [];
    const employees = state.data.employees?.employees || [];
    return `
      <section class="grid two">
        <div class="panel">
          <div class="panel-header"><div><h2>Ajukan izin, cuti, atau sakit</h2><p>Approval berjalan dari Manager lalu HRD.</p></div></div>
          <form id="leave-form" class="form-grid">
            ${adminish() ? `<label class="field"><span>Karyawan</span><select class="select" name="userId"><option value="">Saya sendiri</option>${optionRows(employees)}</select></label>` : ""}
            <div class="split-row">
              <label class="field"><span>Jenis</span><select class="select" name="type" required><option>Cuti Tahunan</option><option>Cuti Sakit</option><option>Izin Khusus</option><option>Dinas Luar</option><option>WFH</option></select></label>
              <label class="field"><span>Lampiran</span><input class="input" name="attachmentName" placeholder="nama-file.pdf" /></label>
            </div>
            <div class="split-row">
              <label class="field"><span>Mulai</span><input class="input" name="startDate" type="date" value="${today()}" required /></label>
              <label class="field"><span>Selesai</span><input class="input" name="endDate" type="date" value="${today()}" required /></label>
            </div>
            <label class="field"><span>Keterangan</span><textarea class="textarea" name="reason" required></textarea></label>
            <button class="btn primary" type="submit">Kirim Pengajuan</button>
          </form>
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Kalender cuti tim</h2><p>Daftar cuti/dinas yang sudah disetujui.</p></div></div>
          ${
            leaves.filter((leave) => leave.status === "Disetujui").length
              ? leaves
                  .filter((leave) => leave.status === "Disetujui")
                  .map((leave) => `<p><strong>${escapeHtml(leave.userName)}</strong><br><span class="muted">${escapeHtml(leave.type)} · ${formatDate(leave.startDate)} - ${formatDate(leave.endDate)}</span></p>`)
                  .join("")
              : empty("Belum ada cuti/dinas disetujui.")
          }
        </div>
      </section>
      ${renderLeaveTable(leaves)}
    `;
  }

  function renderLeaveTable(leaves) {
    return `
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Daftar pengajuan</h2><p>Riwayat approval dan status terbaru.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Karyawan</th><th>Jenis</th><th>Tanggal</th><th>Status</th><th>Alur</th><th>Aksi</th></tr></thead>
            <tbody>
              ${
                leaves.length
                  ? leaves
                      .map(
                        (leave) => `<tr>
                          <td><strong>${escapeHtml(leave.userName)}</strong><br><span class="muted">${escapeHtml(leave.department)}</span></td>
                          <td>${escapeHtml(leave.type)}<br><span class="muted">${escapeHtml(leave.reason)}</span></td>
                          <td>${formatDate(leave.startDate)} - ${formatDate(leave.endDate)}<br><span class="muted">${leave.days} hari kerja</span></td>
                          <td><span class="status ${statusClass(leave.status)}">${escapeHtml(leave.status)}</span></td>
                          <td>${escapeHtml(leave.managerName)} → ${escapeHtml(leave.hrName)}</td>
                          <td>${reviewButtons("leave", leave.id)}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="6">${empty("Belum ada pengajuan.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOvertime() {
    const rows = state.data.overtimes?.overtimes || [];
    const employees = state.data.employees?.employees || [];
    return `
      <section class="grid two">
        <div class="panel">
          <div class="panel-header"><div><h2>Ajukan lembur</h2><p>Batas demo: ${state.master?.settings?.maxOvertimeHoursPerDay || 4} jam per hari.</p></div></div>
          <form id="overtime-form" class="form-grid">
            ${adminish() ? `<label class="field"><span>Karyawan</span><select class="select" name="userId"><option value="">Saya sendiri</option>${optionRows(employees)}</select></label>` : ""}
            <label class="field"><span>Tanggal</span><input class="input" name="date" type="date" value="${today()}" required /></label>
            <div class="split-row">
              <label class="field"><span>Jam mulai</span><input class="input" name="startTime" type="time" value="18:00" required /></label>
              <label class="field"><span>Jam selesai</span><input class="input" name="endTime" type="time" value="20:00" required /></label>
            </div>
            <label class="field"><span>Keterangan</span><textarea class="textarea" name="reason" required></textarea></label>
            <button class="btn primary" type="submit">Kirim Lembur</button>
          </form>
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Payroll lembur</h2><p>Estimasi biaya memakai tarif sistem.</p></div></div>
          ${stat("Tarif per jam", rupiah(state.master?.settings?.overtimeRatePerHour || 0), "Dapat dihubungkan ke payroll")}
        </div>
      </section>
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Daftar lembur</h2><p>Approval Manager dan ringkasan biaya.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Karyawan</th><th>Tanggal</th><th>Jam</th><th>Status</th><th>Estimasi biaya</th><th>Aksi</th></tr></thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (row) => `<tr>
                          <td><strong>${escapeHtml(row.userName)}</strong><br><span class="muted">${escapeHtml(row.department)}</span></td>
                          <td>${formatDate(row.date)}<br><span class="muted">${escapeHtml(row.reason)}</span></td>
                          <td>${escapeHtml(row.startTime)} - ${escapeHtml(row.endTime)}<br><span class="muted">${row.hours} jam</span></td>
                          <td><span class="status ${statusClass(row.status)}">${escapeHtml(row.status)}</span></td>
                          <td>${rupiah(row.costEstimate)}</td>
                          <td>${reviewButtons("overtime", row.id)}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="6">${empty("Belum ada lembur.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderEmployees() {
    const employees = state.data.employees?.employees || [];
    return `
      <section class="grid two">
        <div class="panel">
          <div class="panel-header"><div><h2>Tambah karyawan</h2><p>Default password karyawan baru adalah password123.</p></div></div>
          ${
            adminish()
              ? `<form id="employee-form" class="form-grid">
                  <div class="split-row">
                    <label class="field"><span>NIK</span><input class="input" name="nik" required /></label>
                    <label class="field"><span>Nama</span><input class="input" name="name" required /></label>
                  </div>
                  <label class="field"><span>Email</span><input class="input" name="email" type="email" required /></label>
                  <div class="split-row">
                    <label class="field"><span>Role</span><select class="select" name="role"><option value="employee">Karyawan</option><option value="manager">Manajer</option><option value="hrd_admin">HRD / Admin</option></select></label>
                    <label class="field"><span>Jabatan</span><input class="input" name="position" value="Karyawan" /></label>
                  </div>
                  <div class="split-row">
                    <label class="field"><span>Departemen</span><select class="select" name="departmentId">${optionRows(state.master?.departments || [], 3)}</select></label>
                    <label class="field"><span>Cabang</span><select class="select" name="branchId">${optionRows(state.master?.branches || [], 1)}</select></label>
                  </div>
                  <div class="split-row">
                    <label class="field"><span>Shift</span><select class="select" name="shiftId">${optionRows(state.master?.shifts || [], 1)}</select></label>
                    <label class="field"><span>Manager</span><select class="select" name="managerId"><option value="">Tidak ada</option>${optionRows(state.master?.managers || [], 3)}</select></label>
                  </div>
                  <button class="btn primary" type="submit">Simpan Karyawan</button>
                </form>`
              : empty("Role Manajer dapat melihat tim, tetapi tidak menambah karyawan.")
          }
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Import CSV</h2><p>Format: nik,nama,email,role,department_id,branch_id,shift_id,manager_id,jabatan</p></div></div>
          ${
            adminish()
              ? `<form id="csv-form" class="form-grid">
                  <textarea class="textarea" name="csv" placeholder="nik,nama,email,role,department_id,branch_id,shift_id,manager_id,jabatan&#10;EMP-009,Nadia,nadia@company.test,employee,3,1,1,3,QA Engineer"></textarea>
                  <button class="btn primary" type="submit">Import CSV</button>
                </form>`
              : empty("Import hanya untuk HRD/Super Admin.")
          }
        </div>
      </section>
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Data karyawan</h2><p>NIK, role, departemen, cabang, shift, dan saldo cuti.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>NIK</th><th>Nama</th><th>Role</th><th>Organisasi</th><th>Shift</th><th>Saldo cuti</th><th>Status</th></tr></thead>
            <tbody>
              ${employees
                .map(
                  (employee) => `<tr>
                    <td>${escapeHtml(employee.nik)}</td>
                    <td><strong>${escapeHtml(employee.name)}</strong><br><span class="muted">${escapeHtml(employee.email)}</span></td>
                    <td><span class="role-pill">${roleLabels[employee.role]}</span></td>
                    <td>${escapeHtml(employee.department)}<br><span class="muted">${escapeHtml(employee.branch)}</span></td>
                    <td>${escapeHtml(employee.shift)}</td>
                    <td>${employee.leaveBalance} hari</td>
                    <td><span class="status ${statusClass(employee.employmentStatus)}">${escapeHtml(employee.employmentStatus)}</span></td>
                  </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderShifts() {
    const shifts = state.data.shifts?.shifts || [];
    const schedules = state.data.shifts?.schedules || [];
    const employees = state.data.employees?.employees || [];
    return `
      <section class="grid two">
        <div class="panel">
          <div class="panel-header"><div><h2>Buat shift</h2><p>Atur jam masuk, pulang, toleransi, dan istirahat.</p></div></div>
          ${
            adminish()
              ? `<form id="shift-form" class="form-grid">
                  <label class="field"><span>Nama shift</span><input class="input" name="name" required /></label>
                  <div class="split-row">
                    <label class="field"><span>Jam masuk</span><input class="input" type="time" name="startTime" required /></label>
                    <label class="field"><span>Jam pulang</span><input class="input" type="time" name="endTime" required /></label>
                  </div>
                  <div class="split-row">
                    <label class="field"><span>Toleransi menit</span><input class="input" type="number" name="toleranceMinutes" value="10" /></label>
                    <label class="field"><span>Istirahat menit</span><input class="input" type="number" name="breakMinutes" value="60" /></label>
                  </div>
                  <button class="btn primary" type="submit">Simpan Shift</button>
                </form>`
              : empty("Manajer dapat melihat shift tim.")
          }
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Assign jadwal</h2><p>Jadwal harian mendukung rotasi mingguan/bulanan.</p></div></div>
          ${
            adminish()
              ? `<form id="schedule-form" class="form-grid">
                  <label class="field"><span>Karyawan</span><select class="select" name="userId">${optionRows(employees)}</select></label>
                  <div class="split-row">
                    <label class="field"><span>Tanggal</span><input class="input" type="date" name="date" value="${today()}" required /></label>
                    <label class="field"><span>Shift</span><select class="select" name="shiftId">${optionRows(shifts)}</select></label>
                  </div>
                  <button class="btn primary" type="submit">Assign Shift</button>
                </form>`
              : empty("Assign shift hanya untuk HRD/Super Admin.")
          }
        </div>
      </section>
      <section class="grid three">
        ${shifts.map((shift) => `<div class="stat"><span>${escapeHtml(shift.name)}</span><strong>${escapeHtml(shift.startTime)}-${escapeHtml(shift.endTime)}</strong><small>Toleransi ${shift.toleranceMinutes}m · istirahat ${shift.breakMinutes}m</small></div>`).join("")}
      </section>
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Jadwal shift</h2><p>Data jadwal khusus per tanggal.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Tanggal</th><th>Karyawan</th><th>Shift</th></tr></thead>
            <tbody>
              ${
                schedules.length
                  ? schedules
                      .map((schedule) => {
                        const user = employees.find((item) => item.id === schedule.userId);
                        const shift = shifts.find((item) => item.id === schedule.shiftId);
                        return `<tr><td>${formatDate(schedule.date)}</td><td>${escapeHtml(user?.name || "-")}</td><td>${escapeHtml(shift?.name || "-")}</td></tr>`;
                      })
                      .join("")
                  : `<tr><td colspan="3">${empty("Belum ada jadwal khusus.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderReports() {
    const rows = state.data.reports?.rows || [];
    const employees = state.data.employees?.employees || [];
    const filters = {
      from: state.reportFilters.from || firstDayOfMonth(),
      to: state.reportFilters.to || today(),
      departmentId: state.reportFilters.departmentId || "",
      userId: state.reportFilters.userId || ""
    };
    const totals = rows.reduce(
      (acc, row) => {
        acc.present += row.present;
        acc.late += row.late;
        acc.alpha += row.alpha;
        acc.overtimeHours += row.overtimeHours;
        acc.overtimeCost += row.overtimeCost;
        return acc;
      },
      { present: 0, late: 0, alpha: 0, overtimeHours: 0, overtimeCost: 0 }
    );
    return `
      <section class="panel">
        <div class="panel-header"><div><h2>Filter laporan</h2><p>Rekap harian, mingguan, bulanan, departemen, dan payroll.</p></div></div>
        <form id="report-filter-form" class="grid four">
          <label class="field"><span>Dari</span><input class="input" type="date" name="from" value="${filters.from}" /></label>
          <label class="field"><span>Sampai</span><input class="input" type="date" name="to" value="${filters.to}" /></label>
          <label class="field"><span>Departemen</span><select class="select" name="departmentId"><option value="">Semua</option>${optionRows(state.master?.departments || [], filters.departmentId)}</select></label>
          <label class="field"><span>Karyawan</span><select class="select" name="userId"><option value="">Semua</option>${optionRows(employees, filters.userId)}</select></label>
          <button class="btn primary" type="submit">Terapkan</button>
          <button class="btn ghost" type="button" data-action="export" data-format="xlsx">Export XLSX</button>
          <button class="btn ghost" type="button" data-action="export" data-format="pdf">Export PDF</button>
        </form>
      </section>
      <section class="grid four">
        ${stat("Total hadir", totals.present, "Seluruh karyawan terfilter")}
        ${stat("Terlambat", totals.late, "Kejadian terlambat")}
        ${stat("Alpha", totals.alpha, "Hari kerja tanpa absensi/cuti")}
        ${stat("Biaya lembur", rupiah(totals.overtimeCost), `${totals.overtimeHours} jam`)}
      </section>
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Summary payroll</h2><p>Data siap dipakai untuk kalkulasi payroll.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Karyawan</th><th>Departemen</th><th>Hadir</th><th>Terlambat</th><th>Alpha</th><th>Cuti/Izin</th><th>Jam kerja</th><th>Lembur</th><th>Biaya lembur</th></tr></thead>
            <tbody>
              ${
                rows.length
                  ? rows
                      .map(
                        (row) => `<tr>
                          <td><strong>${escapeHtml(row.name)}</strong><br><span class="muted">${escapeHtml(row.nik)}</span></td>
                          <td>${escapeHtml(row.department)}<br><span class="muted">${escapeHtml(row.branch)}</span></td>
                          <td>${row.present}</td>
                          <td>${row.late}</td>
                          <td>${row.alpha}</td>
                          <td>${row.leaveDays}</td>
                          <td>${row.totalWorkHours}</td>
                          <td>${row.overtimeHours}</td>
                          <td>${rupiah(row.overtimeCost)}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="9">${empty("Belum ada data laporan.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderNotifications() {
    const notifications = state.data.notifications?.notifications || [];
    return `
      <section class="grid two">
        <div class="panel">
          <div class="panel-header">
            <div><h2>Pusat notifikasi</h2><p>Approval, reminder, dan pengumuman.</p></div>
            <button class="btn ghost small" data-action="mark-read">Tandai dibaca</button>
          </div>
          ${
            notifications.length
              ? notifications
                  .map(
                    (item) => `<p><strong>${item.read ? "" : "● "}${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.body)} · ${formatDateTime(item.createdAt)}</span></p>`
                  )
                  .join("")
              : empty("Tidak ada notifikasi.")
          }
        </div>
        <div class="panel">
          <div class="panel-header"><div><h2>Buat pengumuman</h2><p>HRD dapat mengirim pengumuman ke role tertentu.</p></div></div>
          ${
            adminish()
              ? `<form id="announcement-form" class="form-grid">
                  <label class="field"><span>Judul</span><input class="input" name="title" required /></label>
                  <label class="field"><span>Audience</span><select class="select" name="audience"><option value="all">Semua</option><option value="employee">Karyawan</option><option value="manager">Manajer</option><option value="hrd_admin">HRD</option></select></label>
                  <label class="field"><span>Isi</span><textarea class="textarea" name="body" required></textarea></label>
                  <button class="btn primary" type="submit">Kirim Pengumuman</button>
                </form>`
              : empty("Pengumuman dibuat oleh HRD/Super Admin.")
          }
        </div>
      </section>
    `;
  }

  function renderAudit() {
    const logs = state.data.audit?.auditLogs || [];
    return `
      <section class="table-panel">
        <div class="panel-header" style="padding:16px 16px 0"><div><h2>Audit log</h2><p>Semua koreksi, approval, login, dan perubahan master data dicatat.</p></div></div>
        <div class="table-scroll">
          <table>
            <thead><tr><th>Waktu</th><th>Aktor</th><th>Aksi</th><th>Entity</th><th>Detail</th></tr></thead>
            <tbody>
              ${
                logs.length
                  ? logs
                      .map(
                        (log) => `<tr>
                          <td>${formatDateTime(log.at)}</td>
                          <td>${escapeHtml(log.actorName)}</td>
                          <td><span class="chip">${escapeHtml(log.action)}</span></td>
                          <td>${escapeHtml(log.entity)} #${escapeHtml(log.entityId)}</td>
                          <td>${escapeHtml(log.details)}</td>
                        </tr>`
                      )
                      .join("")
                  : `<tr><td colspan="5">${empty("Belum ada audit log.")}</td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function empty(message) {
    return `<div class="empty">${escapeHtml(message)}</div>`;
  }

  function render() {
    if (!state.config) {
      app.innerHTML = `<div class="empty">Menyiapkan aplikasi...</div>`;
      return;
    }
    if (!state.user) renderLogin();
    else renderShell();
  }

  function formData(form) {
    return Object.fromEntries(new FormData(form).entries());
  }

  async function submitForm(event) {
    event.preventDefault();
    const form = event.target;
    const data = formData(form);
    try {
      if (form.id === "login-form") {
        const result = await apiJson("/api/auth/login", { method: "POST", body: data });
        setSession(result);
        state.master = null;
        showToast("Login berhasil.");
        await loadRouteData("dashboard");
        return;
      }
      if (form.id === "leave-form") {
        await apiJson("/api/leaves", { method: "POST", body: data });
        showToast("Pengajuan izin/cuti dikirim.");
        await loadRouteData("leaves");
      }
      if (form.id === "overtime-form") {
        await apiJson("/api/overtimes", { method: "POST", body: data });
        showToast("Pengajuan lembur dikirim.");
        await loadRouteData("overtime");
      }
      if (form.id === "employee-form") {
        await apiJson("/api/employees", { method: "POST", body: data });
        showToast("Karyawan ditambahkan.");
        await loadRouteData("employees");
      }
      if (form.id === "csv-form") {
        const result = await apiJson("/api/employees/import", { method: "POST", body: data });
        showToast(`${result.count} karyawan berhasil diimport.`);
        await loadRouteData("employees");
      }
      if (form.id === "shift-form") {
        await apiJson("/api/shifts", { method: "POST", body: data });
        showToast("Shift dibuat.");
        await loadRouteData("shifts");
      }
      if (form.id === "schedule-form") {
        await apiJson("/api/shift-schedules", { method: "POST", body: data });
        showToast("Jadwal shift diperbarui.");
        await loadRouteData("shifts");
      }
      if (form.id === "report-filter-form") {
        state.reportFilters = data;
        await loadRouteData("reports");
      }
      if (form.id === "announcement-form") {
        await apiJson("/api/announcements", { method: "POST", body: data });
        showToast("Pengumuman dikirim.");
        await loadRouteData("notifications");
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async function clickAction(event) {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    try {
      if (action === "demo-login") {
        const result = await apiJson("/api/auth/login", { method: "POST", body: { email: target.dataset.email, password: "password123" } });
        setSession(result);
        state.master = null;
        showToast(`Masuk sebagai ${roleLabels[state.user.role]}.`);
        await loadRouteData("dashboard");
      }
      if (action === "navigate") {
        state.route = target.dataset.route;
        await loadRouteData(state.route);
      }
      if (action === "logout") {
        clearSession();
        render();
      }
      if (action === "toggle-theme") {
        state.theme = state.theme === "dark" ? "light" : "dark";
        storage.setItem("attendance.theme", state.theme);
        applyTheme();
        render();
      }
      if (action === "use-branch-location") {
        const branch = state.master?.branches?.find((item) => item.id === state.user.branchId) || state.master?.branches?.[0];
        document.querySelector("#attendance-lat").value = branch?.lat || "";
        document.querySelector("#attendance-lng").value = branch?.lng || "";
        showToast("Koordinat cabang demo dipakai.");
      }
      if (action === "use-gps") {
        if (!navigator.geolocation) throw new Error("Browser tidak mendukung geolocation.");
        navigator.geolocation.getCurrentPosition(
          (position) => {
            document.querySelector("#attendance-lat").value = position.coords.latitude.toFixed(6);
            document.querySelector("#attendance-lng").value = position.coords.longitude.toFixed(6);
            showToast("Koordinat perangkat berhasil diambil.");
          },
          () => showToast("Gagal mengambil GPS. Gunakan lokasi cabang demo untuk mencoba.", "error"),
          { enableHighAccuracy: true, timeout: 8000 }
        );
      }
      if (action === "clock-in" || action === "clock-out") {
        const payload = {
          mode: document.querySelector("#attendance-mode")?.value || "onsite",
          lat: document.querySelector("#attendance-lat")?.value,
          lng: document.querySelector("#attendance-lng")?.value,
          notes: document.querySelector("#attendance-notes")?.value || "",
          photoDataUrl: state.selfie
        };
        const endpoint = action === "clock-in" ? "/api/attendances/check-in" : "/api/attendances/check-out";
        const result = await apiJson(endpoint, { method: "POST", body: payload });
        state.selfie = "";
        showToast(result.message);
        await loadRouteData("attendance");
      }
      if (action === "review") {
        const comment = prompt(target.dataset.decision === "reject" ? "Alasan penolakan:" : "Catatan approval:", "");
        const endpoint = target.dataset.type === "leave" ? `/api/leaves/${target.dataset.id}` : `/api/overtimes/${target.dataset.id}`;
        await apiJson(endpoint, { method: "PATCH", body: { decision: target.dataset.decision, comment: comment || "" } });
        showToast("Status approval diperbarui.");
        await loadRouteData(state.route);
      }
      if (action === "correct-attendance") {
        const status = prompt("Status baru (Hadir, Terlambat, Alpha, Izin, Sakit, Cuti):", "Hadir");
        if (!status) return;
        const reason = prompt("Alasan koreksi:", "Koreksi manual HRD");
        await apiJson(`/api/attendances/${target.dataset.id}`, { method: "PATCH", body: { status, reason } });
        showToast("Absensi dikoreksi.");
        await loadRouteData("attendance");
      }
      if (action === "export") {
        const filters = {
          from: state.reportFilters.from || firstDayOfMonth(),
          to: state.reportFilters.to || today(),
          departmentId: state.reportFilters.departmentId || "",
          userId: state.reportFilters.userId || ""
        };
        const query = new URLSearchParams(filters);
        const format = target.dataset.format;
        const blob = await apiBlob(`/api/reports/export.${format}?${query}`);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `rekap-absensi.${format}`;
        anchor.click();
        URL.revokeObjectURL(url);
        showToast(`Export ${format.toUpperCase()} berhasil.`);
      }
      if (action === "mark-read") {
        await apiJson("/api/notifications/read", { method: "POST", body: {} });
        showToast("Notifikasi ditandai dibaca.");
        await loadRouteData("notifications");
      }
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  function changeAction(event) {
    const target = event.target;
    if (target.matches("[data-selfie]")) {
      const file = target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        state.selfie = reader.result;
        const preview = document.querySelector("#selfie-preview");
        if (preview) preview.innerHTML = `<img src="${state.selfie}" alt="Preview selfie" />`;
      };
      reader.readAsDataURL(file);
    }
    if (target.matches("[data-action='mobile-nav']")) {
      state.route = target.value;
      loadRouteData(state.route);
    }
  }

  async function boot() {
    document.addEventListener("submit", submitForm);
    document.addEventListener("click", clickAction);
    document.addEventListener("change", changeAction);
    try {
      state.config = await apiJson("/api/config");
      if (state.accessToken) {
        try {
          const me = await apiJson("/api/me");
          state.user = me.user;
          await loadRouteData("dashboard");
          return;
        } catch {
          clearSession();
        }
      }
      render();
    } catch (error) {
      app.innerHTML = `<div class="empty">Gagal memuat aplikasi: ${escapeHtml(error.message)}</div>`;
    }
  }

  boot();
})();
