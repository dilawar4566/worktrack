import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

// ─── Config ───────────────────────────────────────────────────
const SUPABASE_URL      = 'https://athyhsagfandilsgjjff.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0aHloc2FnZmFuZGlsc2dqamZmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE2ODk3OTUsImV4cCI6MjA5NzI2NTc5NX0.6p9L3liwW0fNcq90clwWQbOJd5d8_iTcDxrLgjzSIE4';
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// How long the timer can run continuously before we nag the user to confirm
// they're still working (prevents an accidentally-left-on timer).
const IDLE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// ─── State ────────────────────────────────────────────────────
const S = {
  user: null, isAdmin: false,
  page: 'auth',

  // Auth
  authMode: 'login',
  authEmail: '', authPassword: '', authName: '',
  authError: '', authLoading: false,

  // Dashboard
  todaySessions: [], activeSession: null,
  clockTitle: '', clockDesc: '', clockLoading: false,
  timerInterval: null, timerDisplay: '0h 0m 0s',
  showIdleModal: false, idleAcknowledgedUntil: null, idleSessionId: null,
  showClockInModal: false, clockInError: '',

  // History
  allSessions: [],
  historySearch: '', historyFrom: '', historyTo: '',

  // Admin
  adminTab: 'sessions',
  adminSessions: [], profiles: {},
  adminSearch: '', adminFrom: '', adminTo: '',
  openEmployee: null,

  // Salary date range (separate from session filter)
  salaryFrom: '', salaryTo: '',

  // Mobile nav
  mobileNavOpen: false,

  // Manual modal
  showManualModal: false,
  manualEmail: '', manualTitle: '', manualDesc: '',
  manualDate: '', manualClockIn: '', manualClockOut: '',
  manualLoading: false, manualError: '',

  // Rate editing
  editingRate: null, rateValue: '',

  // Admin: edit any session
  editingSession: null,
  editTitle: '', editDesc: '', editDate: '', editClockIn: '', editClockOut: '',
  editLoading: false, editError: '',

  // Admin: set employee password directly + delete employee
  settingPasswordFor: null, setPasswordError: '', setPasswordLoading: false, pwUpdatedFor: null,
  adminActionError: '',
  deletingEmployee: null, deleteError: '', deleteLoading: false,

  // My Account (self password change)
  showAccountModal: false, accountError: '', accountSuccess: '', accountLoading: false,
};

// ─── Helpers ──────────────────────────────────────────────────
const $ = id => document.getElementById(id);

// Escape user-controlled text before it goes into innerHTML or an HTML
// attribute, so a task title / name / etc. can't inject markup or scripts.
const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(v) { return String(v ?? '').replace(/[&<>"']/g, c => ESC_MAP[c]); }

function fmt(d) {
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDur(ci, co) {
  const ms = new Date(co || new Date()) - new Date(ci);
  if (ms < 0) return '0m';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}
function fmtLive(ci) {
  const ms = Date.now() - new Date(ci).getTime();
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000) % 60;
  const h = Math.floor(ms / 3600000);
  return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function durMin(ci, co) { return Math.round((new Date(co) - new Date(ci)) / 60000); }
function durHours(sessions) {
  return sessions.filter(s => s.clock_out)
    .reduce((sum, s) => sum + durMin(s.clock_in, s.clock_out) / 60, 0);
}
function todayStr() { return new Date().toISOString().split('T')[0]; }
function isoToLocalDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function isoToLocalTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function monthStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-01`;
}
function initials(email) { return email ? email[0].toUpperCase() : '?'; }

const EMP_COLORS = ['#6366f1','#0891b2','#16a34a','#db2777','#ea580c','#7c3aed','#0d9488'];
function empColor(email) {
  return EMP_COLORS[(email||'').split('').reduce((a,c) => a + c.charCodeAt(0), 0) % EMP_COLORS.length];
}

function groupByEmployee(sessions) {
  const map = {};
  sessions.forEach(s => {
    const k = s.user_email || 'unknown';
    if (!map[k]) map[k] = [];
    map[k].push(s);
  });
  return Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
}

function csvEsc(v) { return `"${String(v ?? '').replace(/"/g, '""')}"`; }

function downloadCSV(rows, filename) {
  const headers = ['Employee','Task','Description','Date','Clock In','Clock Out','Duration (min)','Manual'];
  const lines = [headers.map(csvEsc).join(',')];
  rows.forEach(r => {
    lines.push([
      csvEsc(r.user_email || ''),
      csvEsc(r.task_title || ''),
      csvEsc(r.task_description || ''),
      csvEsc(r.clock_in ? fmtDate(r.clock_in) : ''),
      csvEsc(r.clock_in ? fmt(r.clock_in) : ''),
      csvEsc(r.clock_out ? fmt(r.clock_out) : 'Active'),
      csvEsc(r.clock_out ? durMin(r.clock_in, r.clock_out) : ''),
      csvEsc(r.is_manual ? 'Yes' : 'No'),
    ].join(','));
  });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename }).click();
}

function downloadSalaryCSV(data) {
  const headers = ['Employee','Total Hours','Hourly Rate','Currency','Total Pay'];
  const lines = [headers.map(csvEsc).join(',')];
  data.forEach(e => lines.push([
    csvEsc(e.email), csvEsc(e.hours.toFixed(2)),
    csvEsc(e.rate.toFixed(2)), csvEsc(e.currency),
    csvEsc(e.pay.toFixed(2)),
  ].join(',')));
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `salary-${todayStr()}.csv` }).click();
}

// ─── DB ───────────────────────────────────────────────────────
async function loadToday() {
  if (!S.user) return;
  const { data } = await sb.from('work_sessions').select('*')
    .eq('user_id', S.user.id)
    .gte('clock_in', todayStr() + 'T00:00:00')
    .order('clock_in', { ascending: false });
  S.todaySessions = data || [];
  S.activeSession = S.todaySessions.find(s => !s.clock_out) || null;
  startTimer();
}

async function loadAll() {
  if (!S.user) return;
  let q = sb.from('work_sessions').select('*')
    .or(`user_id.eq.${S.user.id},user_email.eq.${S.user.email}`)
    .order('clock_in', { ascending: false });
  if (S.historyFrom) q = q.gte('clock_in', S.historyFrom + 'T00:00:00');
  if (S.historyTo)   q = q.lte('clock_in', S.historyTo   + 'T23:59:59');
  const { data } = await q;
  S.allSessions = data || [];
}

async function loadAdminData() {
  if (!S.isAdmin) return;
  let q = sb.from('work_sessions').select('*').order('clock_in', { ascending: false });
  if (S.adminFrom) q = q.gte('clock_in', S.adminFrom + 'T00:00:00');
  if (S.adminTo)   q = q.lte('clock_in', S.adminTo   + 'T23:59:59');
  const { data } = await q;
  S.adminSessions = data || [];

  const { data: profs } = await sb.from('employee_profiles').select('*');
  S.profiles = {};
  (profs || []).forEach(p => { S.profiles[p.email] = p; });
}

async function checkAdmin() {
  if (!S.user) return;
  const { data } = await sb.from('admins').select('user_id').eq('user_id', S.user.id).maybeSingle();
  S.isAdmin = !!data;
}

// ─── Actions ──────────────────────────────────────────────────
async function doClockIn() {
  const title = S.clockTitle.trim();
  S.clockInError = '';
  if (!title) { S.clockInError = 'Please enter a task title'; render(); return; }
  S.clockLoading = true; render();
  const { error } = await sb.from('work_sessions').insert({
    user_id: S.user.id, user_email: S.user.email,
    task_title: title, task_description: S.clockDesc.trim(),
    clock_in: new Date().toISOString(),
  });
  S.clockLoading = false;
  if (error) { S.clockInError = error.message; render(); return; }
  S.clockTitle = ''; S.clockDesc = ''; S.showClockInModal = false;
  await loadToday(); render();
}

async function doSaveSessionEdit() {
  if (!S.editingSession) return;
  S.editError = '';
  const title = S.editTitle.trim();
  if (!title || !S.editDate || !S.editClockIn) {
    S.editError = 'Task title, date, and clock-in time are required.';
    render();
    return;
  }
  const ciISO = new Date(`${S.editDate}T${S.editClockIn}`).toISOString();
  let coISO = null;
  if (S.editClockOut) {
    coISO = new Date(`${S.editDate}T${S.editClockOut}`).toISOString();
    if (new Date(coISO) <= new Date(ciISO)) {
      S.editError = 'Clock out must be after clock in.';
      render();
      return;
    }
  }
  S.editLoading = true; render();
  const { error } = await sb.from('work_sessions').update({
    task_title: title,
    task_description: S.editDesc.trim(),
    clock_in: ciISO,
    clock_out: coISO,
  }).eq('id', S.editingSession.id);
  S.editLoading = false;
  if (error) { S.editError = error.message; render(); return; }
  S.editingSession = null;
  await loadAdminData();
  render();
}

async function doClockOut() {
  if (!S.activeSession) return;
  await sb.from('work_sessions').update({ clock_out: new Date().toISOString() }).eq('id', S.activeSession.id);
  clearInterval(S.timerInterval); S.timerInterval = null;
  S.activeSession = null;
  await loadToday(); render();
}

async function doManualEntry() {
  S.manualError = '';
  const { manualEmail: email, manualTitle: title, manualDesc: desc, manualDate: date, manualClockIn: cin, manualClockOut: cout } = S;
  if (!email || !title || !date || !cin || !cout) { S.manualError = 'All fields are required.'; render(); return; }
  const ciISO = new Date(`${date}T${cin}`).toISOString();
  const coISO = new Date(`${date}T${cout}`).toISOString();
  if (new Date(coISO) <= new Date(ciISO)) { S.manualError = 'Clock out must be after clock in.'; render(); return; }
  S.manualLoading = true; render();
  const { error } = await sb.from('work_sessions').insert({
    user_id: null, user_email: email.trim(),
    task_title: title.trim(), task_description: desc.trim(),
    clock_in: ciISO, clock_out: coISO,
    is_manual: true, added_by: S.user.id,
  });
  S.manualLoading = false;
  if (error) { S.manualError = error.message; render(); return; }
  S.showManualModal = false;
  S.manualEmail = S.manualTitle = S.manualDesc = S.manualDate = S.manualClockIn = S.manualClockOut = '';
  await loadAdminData(); render();
}

async function doSaveRate(email) {
  const rate = parseFloat(S.rateValue);
  if (isNaN(rate) || rate < 0) { alert('Please enter a valid rate'); return; }
  if (S.profiles[email]) {
    await sb.from('employee_profiles').update({ hourly_rate: rate, updated_at: new Date().toISOString() }).eq('email', email);
  } else {
    await sb.from('employee_profiles').insert({ email, hourly_rate: rate, currency: 'USD' });
  }
  S.editingRate = null; S.rateValue = '';
  await loadAdminData(); render();
}

// Admin: force-close a session that got left running (e.g. someone forgot
// to clock out days ago). Sets clock_out to right now.
async function doForceClockOut(sessionId) {
  S.adminActionError = '';
  const { error } = await sb.from('work_sessions').update({ clock_out: new Date().toISOString() }).eq('id', sessionId);
  if (error) { S.adminActionError = error.message; render(); return; }
  await loadAdminData(); render();
}

// Admin: set an employee's password directly. Regular client code can only
// ever change the CURRENTLY signed-in user's own password (see
// doChangeOwnPassword below) — setting someone else's password requires
// Supabase's service_role key, which must never be shipped to the browser.
// So this calls a small Supabase Edge Function (see supabase/functions/
// admin-set-password in this repo) that holds that key server-side, checks
// the caller is actually an admin, and only then updates the target user.
async function doSetEmployeePassword() {
  const email = S.settingPasswordFor;
  if (!email) return;
  S.setPasswordError = '';
  const pw1 = $('newEmpPassword')?.value || '';
  const pw2 = $('confirmEmpPassword')?.value || '';
  if (pw1.length < 6) { S.setPasswordError = 'Password must be at least 6 characters.'; render(); return; }
  if (pw1 !== pw2) { S.setPasswordError = 'Passwords do not match.'; render(); return; }
  S.setPasswordLoading = true; render();
  try {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-set-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, newPassword: pw1 }),
    });
    const result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || `Request failed (${res.status})`);
    S.setPasswordLoading = false;
    S.settingPasswordFor = null;
    S.pwUpdatedFor = email;
    render();
    setTimeout(() => { if (S.pwUpdatedFor === email) { S.pwUpdatedFor = null; render(); } }, 5000);
  } catch (err) {
    S.setPasswordLoading = false;
    S.setPasswordError = err.message || 'Could not reach the admin-set-password function. Has it been deployed?';
    render();
  }
}

// Admin: permanently delete an employee's profile and every session they've
// ever logged. Does NOT delete their login (that requires the Supabase
// dashboard / service_role key), so they could still sign back in with a
// blank slate afterward.
async function doDeleteEmployee() {
  const email = S.deletingEmployee;
  if (!email) return;
  const confirmText = ($('deleteConfirmInput')?.value || '').trim();
  S.deleteError = '';
  if (confirmText !== email) {
    S.deleteError = 'Type the email exactly to confirm.';
    render();
    return;
  }
  S.deleteLoading = true; render();
  const { error: sessErr } = await sb.from('work_sessions').delete().eq('user_email', email);
  if (sessErr) { S.deleteLoading = false; S.deleteError = sessErr.message; render(); return; }
  const { error: profErr } = await sb.from('employee_profiles').delete().eq('email', email);
  S.deleteLoading = false;
  if (profErr) { S.deleteError = profErr.message; render(); return; }
  S.deletingEmployee = null;
  if (S.openEmployee === email) S.openEmployee = null;
  await loadAdminData(); render();
}

// Self-service: change your own password (works for any logged-in user,
// including the admin, without needing anyone else's credentials).
async function doChangeOwnPassword() {
  S.accountError = ''; S.accountSuccess = '';
  const pw1 = $('newPassword')?.value || '';
  const pw2 = $('confirmPassword')?.value || '';
  if (pw1.length < 6) { S.accountError = 'Password must be at least 6 characters.'; render(); return; }
  if (pw1 !== pw2) { S.accountError = 'Passwords do not match.'; render(); return; }
  S.accountLoading = true; render();
  const { error } = await sb.auth.updateUser({ password: pw1 });
  S.accountLoading = false;
  if (error) { S.accountError = error.message; render(); return; }
  S.accountSuccess = 'Password updated.';
  render();
}

function startTimer() {
  clearInterval(S.timerInterval); S.timerInterval = null;
  if (S.activeSession) {
    // (Re)start the idle-nag threshold whenever this is a new session.
    if (S.idleSessionId !== S.activeSession.id) {
      S.idleSessionId = S.activeSession.id;
      S.idleAcknowledgedUntil = new Date(S.activeSession.clock_in).getTime() + IDLE_THRESHOLD_MS;
      S.showIdleModal = false;
    }
    const tick = () => {
      S.timerDisplay = fmtLive(S.activeSession.clock_in);
      if (!S.showIdleModal && S.idleAcknowledgedUntil && Date.now() >= S.idleAcknowledgedUntil) {
        S.showIdleModal = true;
      }
      render();
    };
    tick();
    S.timerInterval = setInterval(tick, 1000);
  } else {
    S.idleSessionId = null;
    S.idleAcknowledgedUntil = null;
    S.showIdleModal = false;
  }
}

// ─── Idle timer nag ─────────────────────────────────────────
async function doIdleContinue() {
  const note = $('idleNoteInput')?.value.trim() || '';
  if (note && S.activeSession) {
    const stamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const newDesc = (S.activeSession.task_description ? S.activeSession.task_description + '\n' : '') + `[${stamp}] ${note}`;
    await sb.from('work_sessions').update({ task_description: newDesc }).eq('id', S.activeSession.id);
    S.activeSession.task_description = newDesc;
  }
  S.idleAcknowledgedUntil = Date.now() + IDLE_THRESHOLD_MS;
  S.showIdleModal = false;
  render();
}

async function doIdleClockOut() {
  S.showIdleModal = false;
  await doClockOut();
}

function getGreeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

// ─── Render ───────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!app) return;
  if (S.page === 'auth') {
    app.innerHTML = renderAuth();
  } else {
    app.innerHTML = `
      ${renderNav()}
      <div class="page">
        ${S.page === 'dashboard' ? renderDashboard() :
          S.page === 'history'   ? renderHistory()   :
          S.page === 'admin'     ? renderAdmin()      : ''}
      </div>
      ${S.showManualModal ? renderManualModal() : ''}
      ${S.showIdleModal ? renderIdleModal() : ''}
      ${S.showClockInModal ? renderClockInModal() : ''}
      ${S.editingSession ? renderEditSessionModal() : ''}
      ${S.settingPasswordFor ? renderSetPasswordModal() : ''}
      ${S.deletingEmployee ? renderDeleteEmployeeModal() : ''}
      ${S.showAccountModal ? renderAccountModal() : ''}
    `;
  }
  attachEvents();
}

// ─── Auth ─────────────────────────────────────────────────────
function renderAuth() {
  return `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="auth-logo">
        <h1>⏱ WorkTrack Pro</h1>
        <p>Employee time tracking &amp; salary management</p>
      </div>
      <div class="auth-tabs">
        <div class="auth-tab ${S.authMode==='login'?'active':''}" data-action="authMode" data-val="login">Sign In</div>
        <div class="auth-tab ${S.authMode==='signup'?'active':''}" data-action="authMode" data-val="signup">Create Account</div>
      </div>
      ${S.authError ? `<div class="alert alert-error">${S.authError}</div>` : ''}
      ${S.authMode === 'signup' ? `
      <div class="form-group">
        <label>Full Name</label>
        <input id="authName" type="text" placeholder="Your name" value="${esc(S.authName)}">
      </div>` : ''}
      <div class="form-group">
        <label>Email Address</label>
        <input id="authEmail" type="email" placeholder="you@company.com" value="${esc(S.authEmail)}">
      </div>
      <div class="form-group">
        <label>Password</label>
        <input id="authPass" type="password" placeholder="••••••••">
      </div>
      <button class="btn btn-primary w-full" data-action="auth" ${S.authLoading ? 'disabled' : ''}>
        ${S.authLoading ? '<span class="spin"></span> Loading...' : (S.authMode === 'login' ? 'Sign In' : 'Create Account')}
      </button>
    </div>
  </div>`;
}

// ─── Nav ──────────────────────────────────────────────────────
function renderNav() {
  const tabs = [
    ['dashboard', '🏠 Dashboard'],
    ['history',   '📋 My History'],
    ...(S.isAdmin ? [['admin', '👑 Admin']] : []),
  ];
  return `
  <nav class="nav">
    <div class="nav-brand">⏱ WorkTrack Pro</div>
    <button class="nav-hamburger" data-action="toggleMobileNav" aria-label="Menu">${S.mobileNavOpen ? '✕' : '☰'}</button>
    <div class="nav-menu ${S.mobileNavOpen ? 'open' : ''}">
      ${tabs.map(([p,l]) => `<a class="nav-tab ${S.page===p?'active':''}" href="#" data-action="nav" data-page="${p}">${l}</a>`).join('')}
      <div class="nav-right">
        <span class="nav-email">${esc(S.user?.email || '')}</span>
        ${S.activeSession ? `<span class="badge badge-green"><span class="dot-live"></span> Active</span>` : ''}
        <button class="nav-account" data-action="openAccount">🔑 Account</button>
        <button class="nav-logout" data-action="logout">Sign Out</button>
      </div>
    </div>
  </nav>`;
}

// ─── Dashboard ────────────────────────────────────────────────
function renderDashboard() {
  const todayHours = durHours(S.todaySessions);
  const completed  = S.todaySessions.filter(s => s.clock_out).length;

  return `
  <div class="page-header">
    <h2>Good ${getGreeting()}, ${esc(S.user?.email?.split('@')[0] || 'there')} 👋</h2>
    <p>${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })}</p>
  </div>

  <div class="grid3 mb-2">
    <div class="stat">
      <div class="stat-label">Today's Hours</div>
      <div class="stat-value">${todayHours.toFixed(1)}<span style="font-size:1rem;color:#94a3b8">h</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Tasks Today</div>
      <div class="stat-value">${S.todaySessions.length}</div>
      <div class="stat-sub">${completed} completed</div>
    </div>
    <div class="stat">
      <div class="stat-label">Status</div>
      <div style="margin-top:.6rem">
        ${S.activeSession
          ? `<span class="badge badge-green" style="font-size:.85rem;padding:.35rem .75rem"><span class="dot-live"></span> Clocked In</span>`
          : `<span class="badge badge-gray" style="font-size:.85rem;padding:.35rem .75rem">⚪ Clocked Out</span>`}
      </div>
    </div>
  </div>

  ${S.activeSession ? `
  <div class="active-card mb-2">
    <div class="task-name">📌 ${esc(S.activeSession.task_title)}</div>
    <div class="timer">${S.timerDisplay}</div>
    <div class="since">Clocked in at ${fmt(S.activeSession.clock_in)}</div>
    ${S.activeSession.task_description ? `<div class="since" style="margin-top:.2rem">${esc(S.activeSession.task_description)}</div>` : ''}
    <button class="btn btn-danger mt-2" data-action="clockOut"
      style="background:rgba(255,255,255,.15);border:1.5px solid rgba(255,255,255,.4);color:white">
      ⏹ Clock Out Now
    </button>
  </div>` : `
  <div class="card mb-2">
    <div class="card-title">▶ Ready to start?</div>
    <p class="text-sm text-muted mb-2">Clock in and tell us what you're working on.</p>
    <button class="btn btn-success" data-action="openClockIn">▶ Clock In</button>
  </div>`}

  <div class="card">
    <div class="card-title">📋 Today's Sessions</div>
    ${S.todaySessions.length === 0
      ? `<div class="empty"><div class="empty-icon">📭</div><div>No sessions yet today</div></div>`
      : `<div class="table-wrap"><table>
          <thead><tr><th>Task</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
          <tbody>
            ${S.todaySessions.map(s => `
            <tr>
              <td>
                <div style="font-weight:600">${esc(s.task_title)}</div>
                ${s.task_description ? `<div class="text-xs text-muted mt-1">${esc(s.task_description)}</div>` : ''}
                ${s.is_manual ? `<span class="badge badge-purple text-xs" style="margin-top:.25rem">manual</span>` : ''}
              </td>
              <td class="text-sm">${fmt(s.clock_in)}</td>
              <td class="text-sm">${s.clock_out ? fmt(s.clock_out) : `<span class="badge badge-green">Active</span>`}</td>
              <td class="text-sm" style="font-variant-numeric:tabular-nums">
                ${s.clock_out ? fmtDur(s.clock_in, s.clock_out) : (s === S.activeSession ? S.timerDisplay : '—')}
              </td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
    }
  </div>`;
}

// ─── History ──────────────────────────────────────────────────
function renderHistory() {
  let sessions = S.allSessions;
  if (S.historySearch) {
    const q = S.historySearch.toLowerCase();
    sessions = sessions.filter(s =>
      (s.task_title||'').toLowerCase().includes(q) ||
      (s.task_description||'').toLowerCase().includes(q)
    );
  }
  const totalH = durHours(sessions);
  const done   = sessions.filter(s => s.clock_out).length;

  return `
  <div class="page-header"><h2>📋 My Work History</h2></div>

  <div class="filters">
    <div>
      <label>Search</label>
      <input class="filter-input" id="histSearch" placeholder="🔍 Task name..." value="${esc(S.historySearch)}" data-action="histSearch" style="width:200px">
    </div>
    <div>
      <label>From</label>
      <input class="filter-input" id="histFrom" type="date" value="${S.historyFrom}" data-action="histFrom">
    </div>
    <div>
      <label>To</label>
      <input class="filter-input" id="histTo" type="date" value="${S.historyTo}" data-action="histTo">
    </div>
    <button class="btn btn-outline btn-sm" style="margin-top:1.3rem" data-action="histApply">Apply Filter</button>
    <button class="btn btn-outline btn-sm" style="margin-top:1.3rem" data-action="exportMyCSV">⬇ Export CSV</button>
  </div>

  <div class="grid3 mb-2">
    <div class="stat"><div class="stat-label">Total Hours</div><div class="stat-value">${totalH.toFixed(1)}<span style="font-size:1rem;color:#94a3b8">h</span></div></div>
    <div class="stat"><div class="stat-label">Sessions</div><div class="stat-value">${done}</div></div>
    <div class="stat"><div class="stat-label">Avg Duration</div><div class="stat-value">${done ? (totalH/done).toFixed(1) : '—'}<span style="font-size:1rem;color:#94a3b8">${done?'h':''}</span></div></div>
  </div>

  <div class="card">
    ${sessions.length === 0
      ? `<div class="empty"><div class="empty-icon">📭</div>No sessions found</div>`
      : `<div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Task</th><th>Clock In</th><th>Clock Out</th><th>Duration</th></tr></thead>
          <tbody>
            ${sessions.map(s => `
            <tr>
              <td class="text-sm" style="white-space:nowrap">${fmtDate(s.clock_in)}</td>
              <td>
                <div style="font-weight:600">${esc(s.task_title)}</div>
                ${s.task_description ? `<div class="text-xs text-muted">${esc(s.task_description)}</div>` : ''}
                ${s.is_manual ? `<span class="badge badge-purple" style="font-size:.7rem">manual</span>` : ''}
              </td>
              <td class="text-sm">${fmt(s.clock_in)}</td>
              <td class="text-sm">${s.clock_out ? fmt(s.clock_out) : `<span class="badge badge-green">Active</span>`}</td>
              <td class="text-sm">${s.clock_out ? fmtDur(s.clock_in, s.clock_out) : '—'}</td>
            </tr>`).join('')}
          </tbody>
        </table></div>`
    }
  </div>`;
}

// ─── Admin ────────────────────────────────────────────────────
function renderAdmin() {
  return `
  <div class="page-header">
    <h2>👑 Admin Panel</h2>
    <p>Manage employee sessions, track hours, and calculate salaries</p>
  </div>
  <div class="tabs">
    <div class="tab ${S.adminTab==='sessions'?'active':''}"    data-action="adminTab" data-tab="sessions">📋 Sessions</div>
    <div class="tab ${S.adminTab==='salary'?'active':''}"      data-action="adminTab" data-tab="salary">💰 Salary</div>
    <div class="tab ${S.adminTab==='attendance'?'active':''}"  data-action="adminTab" data-tab="attendance">📊 Attendance</div>
  </div>
  ${S.adminTab === 'sessions'   ? renderAdminSessions()   :
    S.adminTab === 'salary'     ? renderAdminSalary()     :
                                  renderAdminAttendance()}`;
}

// ─── Admin: Sessions ──────────────────────────────────────────
function renderAdminSessions() {
  let sessions = S.adminSessions;
  if (S.adminSearch) {
    const q = S.adminSearch.toLowerCase();
    sessions = sessions.filter(s =>
      (s.user_email||'').toLowerCase().includes(q) ||
      (s.task_title||'').toLowerCase().includes(q)
    );
  }
  const employees = groupByEmployee(sessions);
  const totalH    = durHours(sessions);
  const activeNow = sessions.filter(s => !s.clock_out).length;

  return `
  <div class="filters">
    <div>
      <label>Search</label>
      <input class="filter-input" id="adminSearch" placeholder="🔍 Employee or task..." value="${esc(S.adminSearch)}" data-action="adminSearch" style="width:220px">
    </div>
    <div>
      <label>From</label>
      <input class="filter-input" id="adminFrom" type="date" value="${S.adminFrom}" data-action="adminFrom">
    </div>
    <div>
      <label>To</label>
      <input class="filter-input" id="adminTo" type="date" value="${S.adminTo}" data-action="adminTo">
    </div>
    <button class="btn btn-outline btn-sm" style="margin-top:1.3rem" data-action="adminApply">Apply</button>
    <button class="btn btn-primary btn-sm" style="margin-top:1.3rem" data-action="openManual">➕ Add Manual Hours</button>
    <button class="btn btn-outline btn-sm" style="margin-top:1.3rem;margin-left:auto" data-action="exportAllCSV">⬇ Export All CSV</button>
  </div>

  <div class="grid4 mb-2">
    <div class="stat"><div class="stat-label">Total Sessions</div><div class="stat-value">${sessions.length}</div></div>
    <div class="stat"><div class="stat-label">Employees</div><div class="stat-value">${employees.length}</div></div>
    <div class="stat"><div class="stat-label">Total Hours</div><div class="stat-value">${totalH.toFixed(1)}<span style="font-size:1rem;color:#94a3b8">h</span></div></div>
    <div class="stat"><div class="stat-label">Currently Active</div><div class="stat-value" style="color:${activeNow?'#10b981':'#94a3b8'}">${activeNow}</div></div>
  </div>

  ${employees.length === 0
    ? `<div class="card"><div class="empty"><div class="empty-icon">👥</div>No sessions found</div></div>`
    : employees.map(([email, rows]) => renderAccordion(email, rows)).join('')}`;
}

function renderAccordion(email, rows) {
  const isOpen = S.openEmployee === email;
  const hours  = durHours(rows);
  const active = rows.find(s => !s.clock_out);
  const color  = empColor(email);
  const prof   = S.profiles[email] || {};
  const earned = prof.hourly_rate ? hours * parseFloat(prof.hourly_rate) : null;

  return `
  <div class="accordion">
    <div class="accordion-header" data-action="toggleEmp" data-email="${email}">
      <div class="accordion-avatar" style="background:${color}20;color:${color}">${initials(email)}</div>
      <div class="accordion-info">
        <div class="accordion-name">${esc(prof.full_name || email.split('@')[0])}</div>
        <div class="accordion-email">${esc(email)}</div>
      </div>
      <div class="accordion-meta">
        ${active ? `<span class="badge badge-green"><span class="dot-live"></span> Active</span>` : ''}
        <div class="acc-stat"><div class="v">${rows.length}</div><div class="l">Sessions</div></div>
        <div class="acc-stat"><div class="v">${hours.toFixed(1)}h</div><div class="l">Hours</div></div>
        ${earned !== null ? `<div class="acc-stat"><div class="v" style="color:#6366f1">$${earned.toFixed(0)}</div><div class="l">Earned</div></div>` : ''}
      </div>
      <span class="chevron ${isOpen?'open':''}">▾</span>
    </div>
    ${isOpen ? `
    <div class="accordion-body">
      <div class="accordion-actions">
        <button class="btn btn-outline btn-sm" data-action="exportEmpCSV" data-email="${email}">⬇ Export CSV</button>
        <button class="btn btn-outline btn-sm" data-action="openManualFor" data-email="${email}">➕ Add Hours</button>
        <button class="btn btn-outline btn-sm" data-action="openSetPassword" data-email="${email}">🔑 Set Password</button>
        ${S.pwUpdatedFor === email ? `<span class="badge badge-green">Password updated</span>` : ''}
        <span class="ml-auto text-sm text-muted">${rows.length} sessions · ${hours.toFixed(2)} total hours</span>
      </div>
      ${S.adminActionError ? `<div class="alert alert-error" style="margin:0 1.25rem 1rem">${esc(S.adminActionError)}</div>` : ''}
      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th>Task</th><th>In</th><th>Out</th><th>Duration</th><th>Type</th><th></th></tr></thead>
        <tbody>
          ${rows.map(s => `
          <tr>
            <td class="text-sm" style="white-space:nowrap">${fmtDate(s.clock_in)}</td>
            <td>
              <div style="font-weight:600">${esc(s.task_title)}</div>
              ${s.task_description ? `<div class="text-xs text-muted">${esc(s.task_description)}</div>` : ''}
            </td>
            <td class="text-sm">${fmt(s.clock_in)}</td>
            <td class="text-sm">${s.clock_out ? fmt(s.clock_out) : `<span class="badge badge-green">Active</span>`}</td>
            <td class="text-sm">${s.clock_out ? fmtDur(s.clock_in, s.clock_out) : '—'}</td>
            <td>${s.is_manual ? `<span class="badge badge-purple">Manual</span>` : `<span class="badge badge-gray">Normal</span>`}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-outline btn-xs" data-action="editSession" data-id="${s.id}">✏ Edit</button>
              ${!s.clock_out ? `<button class="btn btn-danger btn-xs" data-action="forceClockOut" data-id="${s.id}">⏹ Force Out</button>` : ''}
            </td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="accordion-actions" style="border-top:1px solid #fef2f2;border-bottom:none;background:#fff7f7;justify-content:flex-end">
        <button class="btn btn-danger btn-sm" data-action="openDeleteEmployee" data-email="${email}">🗑 Delete Employee</button>
      </div>
    </div>` : ''}
  </div>`;
}

// ─── Admin: Salary ────────────────────────────────────────────
function renderAdminSalary() {
  const now = new Date();
  const defFrom = S.salaryFrom || monthStr();
  const defTo   = S.salaryTo   || todayStr();

  let sessions = S.adminSessions.filter(s => s.clock_out);
  if (S.salaryFrom) sessions = sessions.filter(s => s.clock_in >= S.salaryFrom + 'T00:00:00');
  if (S.salaryTo)   sessions = sessions.filter(s => s.clock_in <= S.salaryTo   + 'T23:59:59');

  const grouped   = groupByEmployee(sessions);
  const empData   = grouped.map(([email, rows]) => {
    const hours    = durHours(rows);
    const prof     = S.profiles[email] || {};
    const rate     = parseFloat(prof.hourly_rate) || 0;
    return { email, hours, rate, currency: prof.currency || 'USD', pay: hours * rate, sessions: rows.length };
  });
  const totalPay  = empData.reduce((s, e) => s + e.pay, 0);
  const totalHours= empData.reduce((s, e) => s + e.hours, 0);
  const maxHours  = Math.max(...empData.map(e => e.hours), 0.01);

  return `
  <div class="card mb-2">
    <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap">
      <div class="card-title" style="margin:0">💰 Salary Calculator</div>
      <div style="display:flex;gap:.5rem;align-items:flex-end;margin-left:auto;flex-wrap:wrap">
        <div><label style="font-size:.75rem;color:#64748b;font-weight:600;display:block;margin-bottom:.3rem">From</label>
          <input class="filter-input" id="salFrom" type="date" value="${defFrom}" data-action="salFrom"></div>
        <div><label style="font-size:.75rem;color:#64748b;font-weight:600;display:block;margin-bottom:.3rem">To</label>
          <input class="filter-input" id="salTo" type="date" value="${defTo}" data-action="salTo"></div>
        <button class="btn btn-primary btn-sm" data-action="salApply">Calculate</button>
      </div>
    </div>
    <p class="text-sm text-muted mt-1">Set each employee's hourly rate below, then select a date range to calculate total salary cost.</p>
  </div>

  <div class="grid3 mb-2">
    <div class="stat">
      <div class="stat-label">Total Payroll</div>
      <div class="stat-value" style="color:#6366f1">$${totalPay.toFixed(2)}</div>
      <div class="stat-sub">${defFrom} – ${defTo}</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Hours Worked</div>
      <div class="stat-value">${totalHours.toFixed(1)}<span style="font-size:1rem;color:#94a3b8">h</span></div>
    </div>
    <div class="stat">
      <div class="stat-label">Employees</div>
      <div class="stat-value">${empData.length}</div>
      <div class="stat-sub">${empData.filter(e=>e.rate>0).length} with rate set</div>
    </div>
  </div>

  ${empData.length === 0
    ? `<div class="card"><div class="empty"><div class="empty-icon">💰</div>No completed sessions in this date range</div></div>`
    : empData.map(e => {
        const color   = empColor(e.email);
        const pct     = (e.hours / maxHours) * 100;
        const editing = S.editingRate === e.email;
        return `
        <div class="salary-card">
          <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
            <div class="accordion-avatar" style="background:${color}20;color:${color}">${initials(e.email)}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700">${esc(e.email)}</div>
              <div class="text-sm text-muted">${e.sessions} sessions · ${e.hours.toFixed(2)} hours</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:1.5rem;font-weight:800;color:${e.rate>0?'#6366f1':'#94a3b8'}">${e.currency} ${e.pay.toFixed(2)}</div>
              <div class="text-xs text-muted">@ ${e.rate.toFixed(2)}/hr × ${e.hours.toFixed(2)}h</div>
            </div>
          </div>
          <div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>
          <div class="rate-row mt-2">
            <span class="text-sm text-muted" style="white-space:nowrap">Hourly Rate:</span>
            ${editing ? `
              <input class="rate-input" id="rateInput_${e.email.replace('@','_')}" type="number" min="0" step="0.01" value="${esc(S.rateValue)}" placeholder="0.00">
              <button class="btn btn-primary btn-sm" data-action="saveRate" data-email="${e.email}">Save</button>
              <button class="btn btn-outline btn-sm" data-action="cancelRate">Cancel</button>
            ` : `
              <span style="font-weight:700">${e.currency} ${e.rate.toFixed(2)}/hr</span>
              <button class="btn btn-outline btn-sm" data-action="editRate" data-email="${e.email}" data-rate="${e.rate}">✏ Edit Rate</button>
            `}
          </div>
        </div>`;
      }).join('')
  }

  ${empData.length > 0 ? `
  <div class="mt-2">
    <button class="btn btn-outline" data-action="exportSalary">⬇ Export Salary Report CSV</button>
  </div>` : ''}`;
}

// ─── Admin: Attendance ────────────────────────────────────────
function renderAdminAttendance() {
  const grouped  = groupByEmployee(S.adminSessions);
  const now      = new Date();
  const daysSoFar= now.getDate();

  return `
  <div class="grid3 mb-2">
    <div class="stat"><div class="stat-label">Employees Tracked</div><div class="stat-value">${grouped.length}</div></div>
    <div class="stat"><div class="stat-label">Working Days (Month)</div><div class="stat-value">${daysSoFar}</div></div>
    <div class="stat"><div class="stat-label">Total Hours (All Time)</div><div class="stat-value">${durHours(S.adminSessions).toFixed(1)}<span style="font-size:1rem;color:#94a3b8">h</span></div></div>
  </div>

  ${grouped.length === 0
    ? `<div class="card"><div class="empty"><div class="empty-icon">📊</div>No attendance data yet</div></div>`
    : `<div class="card">
        <div class="card-title">📊 Monthly Attendance — ${now.toLocaleString('en-US',{month:'long',year:'numeric'})}</div>
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Employee</th><th>Days Worked</th><th>Total Hours</th><th>Avg Hrs/Day</th><th>Active Now</th><th>Attendance %</th>
          </tr></thead>
          <tbody>
            ${grouped.map(([email, rows]) => {
              const thisMonth = rows.filter(s => {
                const d = new Date(s.clock_in);
                return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
              });
              const days  = new Set(thisMonth.map(s => s.clock_in?.split('T')[0])).size;
              const hours = durHours(thisMonth);
              const avg   = days ? hours / days : 0;
              const active= rows.filter(s => !s.clock_out).length;
              const pct   = daysSoFar > 0 ? Math.round((days / daysSoFar) * 100) : 0;
              const color = empColor(email);
              const barC  = pct >= 70 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444';
              const prof  = S.profiles[email] || {};
              return `
              <tr>
                <td>
                  <div style="display:flex;align-items:center;gap:.5rem">
                    <div class="accordion-avatar" style="width:32px;height:32px;font-size:.8rem;background:${color}20;color:${color}">${initials(email)}</div>
                    <div>
                      <div style="font-weight:600">${esc(prof.full_name || email.split('@')[0])}</div>
                      <div class="text-xs text-muted">${esc(email)}</div>
                    </div>
                  </div>
                </td>
                <td><strong>${days}</strong></td>
                <td>${hours.toFixed(1)}h</td>
                <td>${avg.toFixed(1)}h</td>
                <td>${active > 0 ? `<span class="badge badge-green">${active} active</span>` : `<span class="badge badge-gray">None</span>`}</td>
                <td style="min-width:140px">
                  <div style="display:flex;align-items:center;gap:.5rem">
                    <div class="att-bar" style="flex:1"><div class="att-fill" style="width:${Math.min(pct,100)}%;background:${barC}"></div></div>
                    <span class="text-sm" style="min-width:38px;font-weight:600;color:${barC}">${pct}%</span>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table></div>
      </div>`
  }`;
}

// ─── Manual Modal ─────────────────────────────────────────────
function renderManualModal() {
  return `
  <div class="modal-bg" data-action="closeModal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">➕ Add Manual Hours</div>
      ${S.manualError ? `<div class="alert alert-error">${S.manualError}</div>` : ''}
      <div class="form-group">
        <label>Employee Email *</label>
        <input id="manEmail" type="email" placeholder="employee@company.com" value="${esc(S.manualEmail)}">
      </div>
      <div class="form-group">
        <label>Task Title *</label>
        <input id="manTitle" type="text" placeholder="What did they work on?" value="${esc(S.manualTitle)}">
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <textarea id="manDesc" placeholder="Additional details...">${esc(S.manualDesc)}</textarea>
      </div>
      <div class="grid3">
        <div class="form-group">
          <label>Date *</label>
          <input id="manDate" type="date" value="${S.manualDate || todayStr()}">
        </div>
        <div class="form-group">
          <label>Clock In *</label>
          <input id="manIn" type="time" value="${S.manualClockIn}">
        </div>
        <div class="form-group">
          <label>Clock Out *</label>
          <input id="manOut" type="time" value="${S.manualClockOut}">
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeModal">Cancel</button>
        <button class="btn btn-primary" data-action="submitManual" ${S.manualLoading ? 'disabled' : ''}>
          ${S.manualLoading ? '<span class="spin"></span> Saving...' : 'Add Hours'}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Idle Timer Modal ──────────────────────────────────────────
function renderIdleModal() {
  const hrs = S.activeSession
    ? Math.max(1, Math.round((Date.now() - new Date(S.activeSession.clock_in).getTime()) / 3600000))
    : 1;
  return `
  <div class="modal-bg">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">⏰ Still working?</div>
      <p style="color:#475569;margin:-.5rem 0 1.25rem;line-height:1.5">
        Your timer for <strong>${esc(S.activeSession?.task_title || 'this task')}</strong> has been running for about ${hrs} hour${hrs > 1 ? 's' : ''} straight.
        Add a quick note if you're still on it, or clock out if you forgot to earlier.
      </p>
      <div class="form-group">
        <label>What are you working on now? (optional)</label>
        <textarea id="idleNoteInput" placeholder="e.g. still debugging the checkout flow..."></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" data-action="idleClockOut">⏹ Clock Out</button>
        <button class="btn btn-primary" data-action="idleContinue">✅ Still Working, Keep Timer On</button>
      </div>
    </div>
  </div>`;
}

// ─── Clock In Modal ─────────────────────────────────────────────
function renderClockInModal() {
  return `
  <div class="modal-bg" data-action="closeClockInModal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">▶ Clock In</div>
      ${S.clockInError ? `<div class="alert alert-error">${esc(S.clockInError)}</div>` : ''}
      <div class="form-group">
        <label>Task Title *</label>
        <input id="clockTitle" type="text" placeholder="What are you working on?" value="${esc(S.clockTitle)}" autofocus>
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <textarea id="clockDesc" placeholder="Any additional details...">${esc(S.clockDesc)}</textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeClockInModal">Cancel</button>
        <button class="btn btn-success" data-action="submitClockIn" ${S.clockLoading ? 'disabled' : ''}>
          ${S.clockLoading ? '<span class="spin"></span> Starting...' : '▶ Start Timer'}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Admin: Edit Session Modal ───────────────────────────────────
function renderEditSessionModal() {
  const s = S.editingSession;
  if (!s) return '';
  return `
  <div class="modal-bg" data-action="closeEditModal">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">✏ Edit Session</div>
      ${S.editError ? `<div class="alert alert-error">${esc(S.editError)}</div>` : ''}
      <div class="form-group">
        <label>Employee</label>
        <input type="text" value="${esc(s.user_email || '')}" disabled style="background:#f8fafc;color:#94a3b8">
      </div>
      <div class="form-group">
        <label>Task Title *</label>
        <input id="editTitle" type="text" value="${esc(S.editTitle)}">
      </div>
      <div class="form-group">
        <label>Description (optional)</label>
        <textarea id="editDesc">${esc(S.editDesc)}</textarea>
      </div>
      <div class="grid3">
        <div class="form-group">
          <label>Date *</label>
          <input id="editDate" type="date" value="${S.editDate}">
        </div>
        <div class="form-group">
          <label>Clock In *</label>
          <input id="editClockIn" type="time" value="${S.editClockIn}">
        </div>
        <div class="form-group">
          <label>Clock Out</label>
          <input id="editClockOut" type="time" value="${S.editClockOut}">
        </div>
      </div>
      <p class="text-xs text-muted" style="margin-top:-.5rem;margin-bottom:1rem">Leave Clock Out empty to keep this session active.</p>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeEditModal">Cancel</button>
        <button class="btn btn-primary" data-action="submitEdit" ${S.editLoading ? 'disabled' : ''}>
          ${S.editLoading ? '<span class="spin"></span> Saving...' : 'Save Changes'}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Admin: Delete Employee Modal ────────────────────────────────
function renderSetPasswordModal() {
  const email = S.settingPasswordFor;
  if (!email) return '';
  return `
  <div class="modal-bg" data-action="closeSetPassword">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">🔑 Set Password for ${esc(email)}</div>
      ${S.setPasswordError ? `<div class="alert alert-error">${esc(S.setPasswordError)}</div>` : ''}
      <div class="form-group">
        <label>New Password</label>
        <input id="newEmpPassword" type="password" placeholder="At least 6 characters">
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input id="confirmEmpPassword" type="password" placeholder="Repeat new password">
      </div>
      <p class="text-xs text-muted" style="margin-top:-.5rem;margin-bottom:1rem">This immediately replaces their current password. Share the new one with them directly.</p>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeSetPassword">Cancel</button>
        <button class="btn btn-primary" data-action="submitSetPassword" ${S.setPasswordLoading ? 'disabled' : ''}>
          ${S.setPasswordLoading ? '<span class="spin"></span> Saving...' : '🔑 Set Password'}
        </button>
      </div>
    </div>
  </div>`;
}

function renderDeleteEmployeeModal() {
  const email = S.deletingEmployee;
  if (!email) return '';
  return `
  <div class="modal-bg" data-action="closeDeleteEmployee">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">🗑 Delete ${esc(email)}?</div>
      ${S.deleteError ? `<div class="alert alert-error">${esc(S.deleteError)}</div>` : ''}
      <div class="alert" style="background:#fff7ed;color:#9a3412;border:1px solid #fed7aa">
        This permanently deletes their profile and every clock-in/out record they've ever logged. It cannot be undone. Their login stays active, deleting the login itself has to be done from the Supabase dashboard.
      </div>
      <div class="form-group">
        <label>Type <strong>${esc(email)}</strong> to confirm</label>
        <input id="deleteConfirmInput" type="text" placeholder="${esc(email)}">
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeDeleteEmployee">Cancel</button>
        <button class="btn btn-danger" data-action="confirmDeleteEmployee" ${S.deleteLoading ? 'disabled' : ''}>
          ${S.deleteLoading ? '<span class="spin"></span> Deleting...' : '🗑 Permanently Delete'}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── My Account Modal ─────────────────────────────────────────────
function renderAccountModal() {
  return `
  <div class="modal-bg" data-action="closeAccount">
    <div class="modal" onclick="event.stopPropagation()">
      <div class="modal-title">🔑 My Account</div>
      ${S.accountError ? `<div class="alert alert-error">${esc(S.accountError)}</div>` : ''}
      ${S.accountSuccess ? `<div class="alert alert-success">${esc(S.accountSuccess)}</div>` : ''}
      <p class="text-sm text-muted mb-2">Signed in as <strong>${esc(S.user?.email || '')}</strong></p>
      <div class="form-group">
        <label>New Password</label>
        <input id="newPassword" type="password" placeholder="At least 6 characters">
      </div>
      <div class="form-group">
        <label>Confirm New Password</label>
        <input id="confirmPassword" type="password" placeholder="Repeat new password">
      </div>
      <div class="modal-footer">
        <button class="btn btn-outline" data-action="closeAccount">Close</button>
        <button class="btn btn-primary" data-action="submitPasswordChange" ${S.accountLoading ? 'disabled' : ''}>
          ${S.accountLoading ? '<span class="spin"></span> Updating...' : 'Update Password'}
        </button>
      </div>
    </div>
  </div>`;
}

// ─── Events ───────────────────────────────────────────────────
function attachEvents() {
  document.querySelectorAll('[data-action]').forEach(el => {
    el.addEventListener('click',  handleClick,  { once: false });
    el.addEventListener('change', handleChange, { once: false });
    el.addEventListener('input',  handleInput,  { once: false });
  });
}

function handleInput(e) {
  const { action } = e.currentTarget.dataset;
  const v = e.target.value;
  if (action === 'adminSearch') { S.adminSearch = v; render(); }
  if (action === 'histSearch')  { S.historySearch = v; render(); }
}

function handleChange(e) {
  const { action } = e.currentTarget.dataset;
  const v = e.target.value;
  if (action === 'histFrom')  S.historyFrom = v;
  if (action === 'histTo')    S.historyTo   = v;
  if (action === 'adminFrom') S.adminFrom   = v;
  if (action === 'adminTo')   S.adminTo     = v;
  if (action === 'salFrom')   S.salaryFrom  = v;
  if (action === 'salTo')     S.salaryTo    = v;
}

async function handleClick(e) {
  const { action, page, val, tab, email, rate, id } = e.currentTarget.dataset;

  switch (action) {
    // Nav
    case 'nav':
      e.preventDefault();
      S.page = page;
      S.mobileNavOpen = false;
      if (page === 'history') { await loadAll(); }
      if (page === 'admin')   { await loadAdminData(); }
      render();
      break;

    case 'toggleMobileNav':
      S.mobileNavOpen = !S.mobileNavOpen;
      render();
      break;

    // Auth
    case 'authMode':
      S.authMode = val; S.authError = ''; render();
      break;

    case 'auth': {
      S.authEmail    = $('authEmail')?.value.trim() || '';
      S.authPassword = $('authPass')?.value || '';
      S.authName     = $('authName')?.value?.trim() || '';
      S.authError = ''; S.authLoading = true; render();

      if (S.authMode === 'login') {
        const { error } = await sb.auth.signInWithPassword({ email: S.authEmail, password: S.authPassword });
        S.authLoading = false;
        if (error) { S.authError = error.message; render(); }
      } else {
        const { error } = await sb.auth.signUp({
          email: S.authEmail, password: S.authPassword,
          options: { data: { full_name: S.authName } }
        });
        S.authLoading = false;
        if (error) { S.authError = error.message; render(); }
        else { S.authMode = 'login'; S.authError = ''; render(); alert('Account created! Please check your email to confirm, then sign in.'); }
      }
      break;
    }

    case 'logout':
      clearInterval(S.timerInterval);
      await sb.auth.signOut();
      Object.assign(S, { user: null, isAdmin: false, page: 'auth', todaySessions: [], allSessions: [], adminSessions: [], activeSession: null, timerInterval: null, mobileNavOpen: false });
      render();
      break;

    // Clock
    case 'openClockIn':
      S.showClockInModal = true; S.clockInError = ''; render();
      break;
    case 'closeClockInModal':
      S.showClockInModal = false; render();
      break;
    case 'submitClockIn':
      S.clockTitle = $('clockTitle')?.value || '';
      S.clockDesc  = $('clockDesc')?.value  || '';
      await doClockIn();
      break;
    case 'clockOut': await doClockOut(); break;

    // Admin: edit any employee's session
    case 'editSession': {
      const sess = S.adminSessions.find(x => String(x.id) === String(id));
      if (!sess) break;
      S.editingSession = sess;
      S.editTitle    = sess.task_title || '';
      S.editDesc     = sess.task_description || '';
      S.editDate     = isoToLocalDate(sess.clock_in);
      S.editClockIn  = isoToLocalTime(sess.clock_in);
      S.editClockOut = sess.clock_out ? isoToLocalTime(sess.clock_out) : '';
      S.editError = '';
      render();
      break;
    }
    case 'closeEditModal':
      S.editingSession = null; render();
      break;
    case 'submitEdit':
      S.editTitle    = $('editTitle')?.value    || '';
      S.editDesc     = $('editDesc')?.value     || '';
      S.editDate     = $('editDate')?.value     || '';
      S.editClockIn  = $('editClockIn')?.value  || '';
      S.editClockOut = $('editClockOut')?.value || '';
      await doSaveSessionEdit();
      break;
    case 'forceClockOut': await doForceClockOut(id); break;

    // Admin: password reset + delete employee
    case 'openSetPassword':
      S.settingPasswordFor = email; S.setPasswordError = ''; render();
      break;
    case 'closeSetPassword':
      S.settingPasswordFor = null; render();
      break;
    case 'submitSetPassword': await doSetEmployeePassword(); break;
    case 'openDeleteEmployee':
      S.deletingEmployee = email; S.deleteError = ''; render();
      break;
    case 'closeDeleteEmployee':
      S.deletingEmployee = null; render();
      break;
    case 'confirmDeleteEmployee': await doDeleteEmployee(); break;

    // My Account
    case 'openAccount':
      S.showAccountModal = true; S.accountError = ''; S.accountSuccess = ''; render();
      break;
    case 'closeAccount':
      S.showAccountModal = false; render();
      break;
    case 'submitPasswordChange': await doChangeOwnPassword(); break;

    // History
    case 'histApply': await loadAll(); render(); break;
    case 'exportMyCSV': downloadCSV(S.allSessions, `my-hours-${todayStr()}.csv`); break;

    // Admin filters
    case 'adminApply': await loadAdminData(); render(); break;
    case 'adminTab': S.adminTab = tab; render(); break;
    case 'salApply': render(); break;

    // Accordion
    case 'toggleEmp':
      S.openEmployee = S.openEmployee === email ? null : email;
      render();
      break;

    // Manual entry
    case 'openManual':
      S.showManualModal = true; S.manualEmail = ''; S.manualError = ''; render();
      break;
    case 'openManualFor':
      S.showManualModal = true; S.manualEmail = email; S.manualError = ''; render();
      break;
    case 'closeModal': S.showManualModal = false; render(); break;

    // Idle timer nag
    case 'idleContinue': await doIdleContinue(); break;
    case 'idleClockOut': await doIdleClockOut(); break;
    case 'submitManual':
      S.manualEmail    = $('manEmail')?.value  || '';
      S.manualTitle    = $('manTitle')?.value  || '';
      S.manualDesc     = $('manDesc')?.value   || '';
      S.manualDate     = $('manDate')?.value   || '';
      S.manualClockIn  = $('manIn')?.value     || '';
      S.manualClockOut = $('manOut')?.value    || '';
      await doManualEntry();
      break;

    // Rate
    case 'editRate':
      S.editingRate = email; S.rateValue = rate || '0'; render();
      break;
    case 'cancelRate': S.editingRate = null; render(); break;
    case 'saveRate': {
      const inputEl = document.getElementById(`rateInput_${email.replace('@','_')}`);
      S.rateValue = inputEl?.value || '0';
      await doSaveRate(email);
      break;
    }

    // Exports
    case 'exportAllCSV': downloadCSV(S.adminSessions, `all-sessions-${todayStr()}.csv`); break;
    case 'exportEmpCSV': {
      const rows = S.adminSessions.filter(s => s.user_email === email);
      downloadCSV(rows, `${email.split('@')[0]}-sessions-${todayStr()}.csv`);
      break;
    }
    case 'exportSalary': {
      const done = S.adminSessions.filter(s => s.clock_out);
      const data = groupByEmployee(done).map(([em, rows]) => {
        const hours = durHours(rows);
        const prof  = S.profiles[em] || {};
        const rate2 = parseFloat(prof.hourly_rate) || 0;
        return { email: em, hours, rate: rate2, currency: prof.currency || 'USD', pay: hours * rate2 };
      });
      downloadSalaryCSV(data);
      break;
    }
  }
}

// ─── Init ─────────────────────────────────────────────────────
async function init() {
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) {
    S.user = session.user;
    await checkAdmin();
    S.page = 'dashboard';
    await loadToday();
  }
  render();

  sb.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session?.user) {
      S.user = session.user;
      await checkAdmin();
      S.page = 'dashboard';
      await loadToday();
      render();
    } else if (event === 'SIGNED_OUT') {
      S.user = null; S.isAdmin = false; S.page = 'auth';
      render();
    }
  });
}

init();
