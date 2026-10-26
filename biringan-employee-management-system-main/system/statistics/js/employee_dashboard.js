/* Biri-Go HR portal: single-page app.
 *
 * Data comes from the server API. If it can't be reached the page falls back to
 * in-memory demo data so the UI can still be tried out.
 *
 *   GET  /api/hr/me          -> { name }   (shown in the top bar; optional)
 *   GET  /api/hr/bootstrap   -> { employees, departments, positions, jobs, applicants, leaves, attendance,
 *                                 onboarding, reviews, trainings, announcements, settings, activity }
 *   POST /api/hr/<resource>  -> body { action, ...fields } -> { ok: true } or { error: "message" }
 *
 *   employees     create | update
 *   departments   create | update | delete
 *   jobs          create | update | delete
 *   applicants    create | update | delete | move {id, stage} | hire {applicant_id, department_id, position_id, employment_type, date_hired}
 *   onboarding    start {employee_id, type} | toggle {id, index} | delete
 *   attendance    create | update | delete
 *   leaves        create | review {id, status, remarks} | delete
 *   reviews       create | update | delete
 *   trainings     create | update | delete
 *   announcements create | update | delete
 *   holidays      create {name, date} | delete {id}
 *   settings      save {...}
 */
(() => {
  'use strict';

  const API = '/api/hr';
  const PAGE_SIZE = 10;
  const SECTIONS = ['dashboard', 'employees', 'recruitment', 'onboarding', 'attendance', 'leaves', 'performance', 'training', 'announcements', 'departments', 'reports', 'settings'];
  const TITLES = {
    dashboard: 'Dashboard', employees: 'Employees', recruitment: 'Recruitment', onboarding: 'Onboarding', attendance: 'Attendance',
    leaves: 'Leaves', performance: 'Performance', training: 'Training', announcements: 'Announcements', departments: 'Departments',
    reports: 'Reports', settings: 'Settings',
  };
  const STATUSES = ['Active', 'On Leave', 'Resigned', 'Terminated'];
  const EMP_TYPES = ['Regular', 'Probationary', 'Contractual', 'Part-time'];
  const STAGES = ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
  const LEAVE_TYPES = ['Vacation', 'Sick', 'Emergency', 'Maternity', 'Paternity', 'Unpaid'];
  const ATT_LABEL = { present: 'Present', late: 'Late', absent: 'Absent', half_day: 'Half Day' };
  const ONBOARD_TASKS = ['Sign employment contract', 'Submit government IDs and requirements', 'Create email and system accounts', 'Issue equipment and ID', 'Orientation and company policies', 'Introduce to team and supervisor', '30-day check-in'];
  const OFFBOARD_TASKS = ['Receive resignation / termination letter', 'Exit interview', 'Return company equipment', 'Disable system access', 'Final pay and clearance', 'Issue certificate of employment'];

  /* ---------- helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const label = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const slug = (s) => String(s).toLowerCase().replace(/[\s_]+/g, '-');
  const badge = (s) => `<span class="badge badge-${slug(s)}">${esc(label(s))}</span>`;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => iso(new Date());
  const parse = (s) => new Date(`${s}T00:00:00`);
  const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
  const addMonths = (s, n) => { const d = parse(s); d.setMonth(d.getMonth() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parse(b) - parse(a)) / 86400000);
  const fmtDate = (s) => (s ? parse(s).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : '-');
  const sum = (a) => a.reduce((x, y) => x + (Number(y) || 0), 0);
  const emptyRow = (cols, msg) => `<tr><td colspan="${cols}" class="empty-row">${esc(msg)}</td></tr>`;
  const emptyLi = (msg) => `<li class="empty">${esc(msg)}</li>`;
  const stars = (n) => `<span class="stars" aria-label="${n} out of 5">${'★'.repeat(n)}<span class="off">${'★'.repeat(5 - n)}</span></span>`;
  const addMin = (t, m) => { const [h, mi] = t.split(':').map(Number); const x = h * 60 + mi + Number(m); return `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`; };
  const hoursBetween = (a, b) => { if (!a || !b) return null; const m = (t) => +t.slice(0, 2) * 60 + +t.slice(3, 5); return Math.max(0, (m(b) - m(a)) / 60); };

  /* ---------- state ---------- */
  let state = emptyState();
  let demo = false;
  const ui = { page: 1, query: '', dept: '', status: '', type: '', job: '', leaveStatus: '', leaveType: '', attDate: today(), attDept: '', process: '' };

  function emptyState() {
    return { employees: [], departments: [], positions: [], jobs: [], applicants: [], leaves: [], attendance: [], onboarding: [], reviews: [], trainings: [], announcements: [], settings: { holidays: [] }, activity: [] };
  }
  const S = () => state.settings;
  const find = (list, id) => state[list].find((x) => x.id == id);
  const emp = (id) => find('employees', id);
  const dept = (id) => find('departments', id);
  const pos = (id) => find('positions', id);
  const job = (id) => find('jobs', id);
  const deptName = (id) => (dept(id) || {}).name || '-';
  const posTitle = (id) => (pos(id) || {}).title || '-';
  const fullName = (e) => {
    if (!e) return '-';
    const mid = e.middle_name ? ` ${e.middle_name[0]}.` : '';
    const suf = e.suffix && e.suffix.toLowerCase() !== 'none' ? ` ${e.suffix}` : '';
    return `${e.last_name}, ${e.first_name}${mid}${suf}`;
  };
  const niceName = (e) => (e ? `${e.first_name} ${e.last_name}` : '-');
  const initials = (e) => `${(e.first_name || '?')[0]}${(e.last_name || '')[0] || ''}`.toUpperCase();
  const person = (e) => `<div class="person"><span class="avatar">${esc(initials(e))}</span><div><button type="button" class="link-btn" data-action="view-employee" data-id="${e.id}">${esc(fullName(e))}</button><span class="sub">${esc(e.email || '')}</span></div></div>`;
  const activeEmployees = () => state.employees.filter((e) => e.status === 'Active' || e.status === 'On Leave');

  /* ---------- leave rules ---------- */
  const leaveDays = (l) => diffDays(l.start_date, l.end_date) + 1;
  const entitlement = (type) => {
    const key = { Vacation: 'leave_vacation', Sick: 'leave_sick', Emergency: 'leave_emergency' }[type];
    return key ? Number(S()[key] ?? 0) : null;
  };
  function leaveUsed(empId, type, year, ignoreId, statuses = ['Approved']) {
    return sum(state.leaves.filter((l) => l.employee_id == empId && l.leave_type === type && l.id != ignoreId &&
      statuses.includes(l.status) && l.start_date.slice(0, 4) === String(year)).map(leaveDays));
  }
  function validateLeave(p) {
    if (!p.employee_id) throw new Error('Choose an employee.');
    if (!p.start_date || !p.end_date) throw new Error('Choose the leave dates.');
    if (p.end_date < p.start_date) throw new Error('The end date cannot be before the start date.');
    const days = diffDays(p.start_date, p.end_date) + 1;
    const ent = entitlement(p.leave_type);
    if (ent !== null) {
      const used = leaveUsed(p.employee_id, p.leave_type, p.start_date.slice(0, 4), p.id, ['Approved', 'Pending']);
      if (used + days > ent) throw new Error(`Only ${Math.max(0, ent - used)} ${p.leave_type.toLowerCase()} day(s) left for this employee this year.`);
    }
    const clash = state.leaves.find((l) => l.employee_id == p.employee_id && l.id != p.id && l.status !== 'Rejected' &&
      l.start_date <= p.end_date && l.end_date >= p.start_date);
    if (clash) throw new Error('This employee already has a leave request on those dates.');
  }
  const onLeaveOn = (date) => state.leaves.filter((l) => l.status === 'Approved' && l.start_date <= date && l.end_date >= date);

  /* ---------- data layer ---------- */
  async function load() {
    try {
      const r = await fetch(`${API}/bootstrap`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('bad status');
      state = { ...emptyState(), ...(await r.json()) };
      demo = false;
    } catch (_) {
      state = demoData();
      demo = true;
    }
    $('demo-banner').hidden = !demo;
    await loadMe();
  }

  let me = { name: 'HR' };
  async function loadMe() {
    me = { name: demo ? 'Demo HR Officer' : 'HR' };
    if (!demo) {
      try {
        const r = await fetch(`${API}/me`, { headers: { Accept: 'application/json' } });
        if (r.ok) { const m = await r.json(); me = { name: m.name || m.username || 'HR' }; }
      } catch (_) { /* keep default */ }
    }
    $('hr-name').textContent = me.name;
    $('hr-avatar').textContent = me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
    $('hr-status').dataset.state = demo ? 'demo' : 'online';
    $('hr-status-text').textContent = demo ? 'Demo mode' : 'Connected';
    $('hr-status').title = demo ? 'The server API was not reachable. Showing sample data.' : 'Connected to the server';
  }

  async function mutate(resource, action, payload = {}) {
    if (demo) return demoMutate(resource, action, payload);
    const r = await fetch(`${API}/${resource}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.error) throw new Error(data.error || 'Request failed.');
    await load();
  }

  /* ---------- demo data ---------- */
  function demoData() {
    const t = today();
    const departments = ['Human Resources', 'IT', 'Finance', 'Operations'].map((name, i) => ({ id: i + 1, name, head_id: null }));
    const positions = [[1, 'HR Officer'], [1, 'Recruiter'], [2, 'Developer'], [2, 'IT Support'], [3, 'Accountant'], [3, 'Payroll Clerk'], [4, 'Supervisor'], [4, 'Staff']]
      .map(([department_id, title], i) => ({ id: i + 1, department_id, title }));
    const names = [['Ana', 'Reyes'], ['Ben', 'Santos'], ['Carla', 'Cruz'], ['Dino', 'Garcia'], ['Elena', 'Bautista'], ['Felix', 'Ramos'], ['Gina', 'Mendoza'], ['Hugo', 'Flores'],
      ['Iris', 'Torres'], ['Jose', 'Aquino'], ['Kara', 'Castro'], ['Leo', 'Dela Cruz'], ['Mia', 'Navarro'], ['Noel', 'Villanueva'], ['Olga', 'Lim'], ['Paolo', 'Tan']];
    const month = parse(t).getMonth() + 1;
    const employees = names.map(([first_name, last_name], i) => {
      const d = departments[i % 4]; const ps = positions.filter((p) => p.department_id === d.id); const p = ps[i % ps.length];
      const probation = i % 5 === 0 && i > 0;
      let hired = probation ? addDays(t, -160) : addDays(t, -(200 + i * 130));
      if (i === 4) hired = addMonths(t, -36);
      if (i === 7) hired = addMonths(t, -12);
      const bm = i < 3 ? month : ((i * 5) % 12) + 1;
      return {
        id: i + 1, employee_no: `EMP-${pad(i + 1).padStart(4, '0')}`, first_name, middle_name: '', last_name, suffix: '',
        sex: i % 2 ? 'Male' : 'Female', birthday: `199${i % 10}-${pad(bm)}-${pad(4 + i * 6 % 24)}`,
        email: `${first_name.toLowerCase()}@biringan.ph`, phone: `0917${String(1000000 + i * 7919).slice(0, 7)}`, address: 'Quezon City',
        department_id: d.id, position_id: p.id, employment_type: probation ? 'Probationary' : i % 7 === 6 ? 'Contractual' : 'Regular',
        date_hired: hired, status: i === 3 ? 'On Leave' : i === 14 ? 'Resigned' : 'Active',
        emergency_name: 'Family contact', emergency_phone: '09170000000',
      };
    });
    departments.forEach((d) => { d.head_id = (employees.find((e) => e.department_id === d.id) || {}).id || null; });
    const leaves = [
      { id: 1, employee_id: 4, leave_type: 'Sick', start_date: addDays(t, -1), end_date: addDays(t, 1), reason: 'Flu and fever', status: 'Approved', remarks: '' },
      { id: 2, employee_id: 2, leave_type: 'Vacation', start_date: addDays(t, 7), end_date: addDays(t, 11), reason: 'Family trip', status: 'Pending', remarks: '' },
      { id: 3, employee_id: 7, leave_type: 'Emergency', start_date: addDays(t, 3), end_date: addDays(t, 3), reason: 'Family emergency', status: 'Pending', remarks: '' },
      { id: 4, employee_id: 9, leave_type: 'Vacation', start_date: addDays(t, -20), end_date: addDays(t, -18), reason: 'Rest', status: 'Rejected', remarks: 'Short staffed that week' },
      { id: 5, employee_id: 6, leave_type: 'Vacation', start_date: addDays(t, 14), end_date: addDays(t, 16), reason: 'Out of town', status: 'Approved', remarks: '' },
    ];
    const attendance = [];
    [0, -1, -2].forEach((n) => employees.filter((e) => e.status === 'Active').forEach((e) => {
      const k = (e.id + n + 7) % 8;
      const status = k === 0 ? 'absent' : k === 3 ? 'late' : k === 5 ? 'half_day' : 'present';
      attendance.push({
        id: attendance.length + 1, employee_id: e.id, work_date: addDays(t, n), status, remarks: '',
        time_in: status === 'absent' ? '' : status === 'late' ? '08:42' : '07:55', time_out: status === 'absent' ? '' : status === 'half_day' ? '12:00' : '17:05',
      });
    }));
    const jobs = [
      { id: 1, title: 'Senior Developer', department_id: 2, type: 'Regular', openings: 2, status: 'Open', posted: addDays(t, -12), description: 'Build and maintain internal systems.' },
      { id: 2, title: 'Accountant', department_id: 3, type: 'Regular', openings: 1, status: 'Open', posted: addDays(t, -30), description: 'General ledger and reporting.' },
      { id: 3, title: 'Warehouse Staff', department_id: 4, type: 'Contractual', openings: 3, status: 'On Hold', posted: addDays(t, -60), description: 'Receiving and dispatch.' },
    ];
    const ap = (id, job_id, first_name, last_name, stage, source) => ({ id, job_id, first_name, last_name, email: `${first_name.toLowerCase()}.${last_name.toLowerCase()}@mail.com`, phone: '09181234567', stage, source, applied: addDays(t, -id * 2), interview_date: stage === 'Interview' ? addDays(t, 2) : '', notes: '' });
    const applicants = [ap(1, 1, 'Rafael', 'Domingo', 'Applied', 'Website'), ap(2, 1, 'Sofia', 'Lopez', 'Screening', 'Referral'), ap(3, 1, 'Miguel', 'Perez', 'Interview', 'JobStreet'),
      ap(4, 1, 'Teresa', 'Uy', 'Offer', 'LinkedIn'), ap(5, 2, 'Victor', 'Sy', 'Applied', 'Website'), ap(6, 2, 'Wendy', 'Go', 'Interview', 'Referral'), ap(7, 2, 'Xander', 'Ong', 'Rejected', 'JobStreet'),
      ap(8, 3, 'Yuri', 'Chua', 'Applied', 'Walk-in'), ap(9, 3, 'Zara', 'Lee', 'Screening', 'Website')];
    const mk = (n) => (n.type === 'Onboarding' ? ONBOARD_TASKS : OFFBOARD_TASKS).map((title, i) => ({ title, done: i < n.done }));
    const onboarding = [
      { id: 1, employee_id: 11, type: 'Onboarding', started: addDays(t, -9), tasks: mk({ type: 'Onboarding', done: 3 }) },
      { id: 2, employee_id: 15, type: 'Offboarding', started: addDays(t, -4), tasks: mk({ type: 'Offboarding', done: 1 }) },
    ];
    const reviews = [
      { id: 1, employee_id: 1, period: 'H1 2026', reviewer: 'Ben Santos', rating: 5, strengths: 'Reliable and organised.', improvements: 'Delegate more.', goals: 'Lead the onboarding revamp.', status: 'Completed' },
      { id: 2, employee_id: 3, period: 'H1 2026', reviewer: 'Ana Reyes', rating: 4, strengths: 'Strong technical skills.', improvements: 'Documentation.', goals: 'Mentor a junior.', status: 'Completed' },
      { id: 3, employee_id: 5, period: 'H1 2026', reviewer: 'Ana Reyes', rating: 3, strengths: 'Meets targets.', improvements: 'Proactiveness.', goals: 'Complete finance certification.', status: 'Completed' },
      { id: 4, employee_id: 8, period: 'H2 2026', reviewer: 'Ana Reyes', rating: 0, strengths: '', improvements: '', goals: '', status: 'Draft' },
    ];
    const trainings = [
      { id: 1, title: 'Workplace Safety', trainer: 'Safety Office', date: addDays(t, 5), hours: 4, venue: 'Training Room', capacity: 20, status: 'Upcoming', participants: [1, 2, 3, 4] },
      { id: 2, title: 'Leadership Essentials', trainer: 'Ana Reyes', date: addDays(t, -14), hours: 8, venue: 'Conference Hall', capacity: 10, status: 'Completed', participants: [5, 6, 7] },
      { id: 3, title: 'Data Privacy Awareness', trainer: 'External', date: addDays(t, 20), hours: 3, venue: 'Online', capacity: 50, status: 'Upcoming', participants: [] },
    ];
    const announcements = [
      { id: 1, title: 'Year-end party', body: 'Save the date! Venue and program to be announced.', audience: 'All employees', priority: 'Normal', date: addDays(t, -2), pinned: false },
      { id: 2, title: 'New leave filing process', body: 'Please file all leave requests at least 3 days in advance.', audience: 'All employees', priority: 'Important', date: addDays(t, -6), pinned: true },
      { id: 3, title: 'Health benefits enrollment', body: 'Enrollment for the new HMO plan opens next week.', audience: 'All employees', priority: 'Normal', date: addDays(t, -10), pinned: false },
    ];
    return {
      employees, departments, positions, jobs, applicants, leaves, attendance, onboarding, reviews, trainings, announcements,
      settings: { work_start: '08:00', work_end: '17:00', grace_minutes: 10, leave_vacation: 15, leave_sick: 7, leave_emergency: 3, probation_months: 6,
        holidays: [{ id: 1, name: 'Christmas Day', date: `${new Date().getFullYear()}-12-25` }, { id: 2, name: 'Rizal Day', date: `${new Date().getFullYear()}-12-30` }] },
      activity: [],
    };
  }

  function demoMutate(resource, action, p) {
    const nextId = (arr) => Math.max(0, ...arr.map((x) => x.id)) + 1;
    if (resource === 'settings') { Object.assign(state.settings, p); return; }
    if (resource === 'holidays') {
      const h = state.settings.holidays;
      if (action === 'create') h.push({ id: nextId(h), name: p.name, date: p.date });
      else state.settings.holidays = h.filter((x) => x.id != p.id);
      return;
    }
    const list = state[resource];
    if (resource === 'employees' && action === 'create') {
      if (state.employees.some((e) => e.email.toLowerCase() === p.email.toLowerCase())) throw new Error('That email is already in use.');
      const id = nextId(list);
      list.push({ ...p, id, employee_no: `EMP-${String(id).padStart(4, '0')}` });
    } else if (resource === 'applicants' && action === 'move') {
      find('applicants', p.id).stage = p.stage;
    } else if (resource === 'applicants' && action === 'hire') {
      const a = find('applicants', p.applicant_id);
      const id = nextId(state.employees);
      state.employees.push({ id, employee_no: `EMP-${String(id).padStart(4, '0')}`, first_name: a.first_name, middle_name: '', last_name: a.last_name, suffix: '', sex: '', birthday: '',
        email: a.email, phone: a.phone, address: '', department_id: +p.department_id, position_id: +p.position_id, employment_type: p.employment_type, date_hired: p.date_hired, status: 'Active', emergency_name: '', emergency_phone: '' });
      a.stage = 'Hired';
      state.onboarding.push({ id: nextId(state.onboarding), employee_id: id, type: 'Onboarding', started: today(), tasks: ONBOARD_TASKS.map((title) => ({ title, done: false })) });
    } else if (resource === 'onboarding' && action === 'start') {
      if (state.onboarding.some((o) => o.employee_id == p.employee_id && o.type === p.type && o.tasks.some((t) => !t.done))) throw new Error(`A ${p.type.toLowerCase()} process is already in progress for this employee.`);
      state.onboarding.push({ id: nextId(list), employee_id: +p.employee_id, type: p.type, started: today(), tasks: (p.type === 'Onboarding' ? ONBOARD_TASKS : OFFBOARD_TASKS).map((title) => ({ title, done: false })) });
    } else if (resource === 'onboarding' && action === 'toggle') {
      const t = find('onboarding', p.id).tasks[p.index]; t.done = !t.done;
    } else if (resource === 'leaves' && action === 'review') {
      Object.assign(find('leaves', p.id), { status: p.status, remarks: p.remarks || '' });
    } else if (resource === 'leaves' && action === 'create') {
      list.push({ ...p, id: nextId(list), status: 'Pending', remarks: '' });
    } else if (action === 'create') {
      if (resource === 'departments' && list.some((d) => d.name.toLowerCase() === p.name.toLowerCase())) throw new Error('That department already exists.');
      list.push({ ...p, id: nextId(list) });
    } else if (action === 'update') {
      Object.assign(find(resource, p.id), p);
    } else if (action === 'delete') {
      state[resource] = list.filter((x) => x.id != p.id);
    }
  }

  /* ---------- toast + modals ---------- */
  let toastTimer;
  function toast(message, type = 'success') {
    const el = $('toast');
    el.textContent = message; el.className = `toast toast-${type}`; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
  }
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    $(id).hidden = false;
    const first = $(id).querySelector('input:not([type="hidden"]), select, textarea');
    if (first) first.focus();
  }
  function closeModal(m) {
    m.hidden = true;
    const err = m.querySelector('.form-error');
    if (err) err.hidden = true;
    if (lastFocus && document.body.contains(lastFocus) && lastFocus.focus) lastFocus.focus();
  }
  function showError(id, message) { const el = $(id); el.textContent = message; el.hidden = false; }

  /* ---------- generic form modal ---------- */
  let formCtx = null;

  function fieldHtml(f, vals) {
    const id = `f-${f.name}`;
    const v = vals[f.name] ?? '';
    const req = f.required ? ' required' : '';
    const attrs = [f.min !== undefined ? `min="${f.min}"` : '', f.max !== undefined ? `max="${f.max}"` : '', f.step ? `step="${f.step}"` : '',
      f.maxlength ? `maxlength="${f.maxlength}"` : '', f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''].join(' ');
    const optList = () => (typeof f.options === 'function' ? f.options(vals) : f.options || []).map((o) => (Array.isArray(o) ? o : [o, o]));
    if (f.type === 'checks') {
      const chosen = (vals[f.name] || []).map(String);
      return `<fieldset class="full"><legend>${esc(f.label)} ${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</legend>${optList().map(([val, lab]) =>
        `<label class="check"><input type="checkbox" name="${f.name}" value="${esc(val)}"${chosen.includes(String(val)) ? ' checked' : ''}> ${esc(lab)}</label>`).join('') || '<span class="muted">Nothing to choose from.</span>'}</fieldset>`;
    }
    let control;
    if (f.type === 'select') {
      control = `<select id="${id}" name="${f.name}"${req}>${f.blank !== undefined ? `<option value="">${esc(f.blank)}</option>` : ''}${optList().map(([val, lab]) =>
        `<option value="${esc(val)}"${String(val) === String(v) ? ' selected' : ''}>${esc(lab)}</option>`).join('')}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${id}" name="${f.name}" rows="3"${req} ${attrs}>${esc(v)}</textarea>`;
    } else {
      control = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}"${req} ${attrs}>`;
    }
    return `<label${f.full || f.type === 'textarea' ? ' class="full"' : ''} for="${id}">${esc(f.label)}${control}</label>`;
  }

  function readForm() {
    const v = {};
    formCtx.fields.forEach((f) => {
      if (f.type === 'checks') { v[f.name] = [...document.querySelectorAll(`#form-fields input[name="${f.name}"]:checked`)].map((i) => +i.value); return; }
      const el = $(`f-${f.name}`);
      if (!el) { v[f.name] = formCtx.vals[f.name]; return; }
      const raw = el.value.trim();
      v[f.name] = f.num ? (raw === '' ? null : Number(raw)) : f.type === 'number' ? (raw === '' ? '' : Number(raw)) : raw;
    });
    return v;
  }

  function drawForm(focusName) {
    $('form-fields').innerHTML = formCtx.fields.map((f) => fieldHtml(f, formCtx.vals)).join('');
    formCtx.fields.filter((f) => f.refresh).forEach((f) => {
      $(`f-${f.name}`).addEventListener('change', () => { formCtx.vals = readForm(); drawForm(f.name); });
    });
    if (focusName && $(`f-${focusName}`)) $(`f-${focusName}`).focus();
  }

  function openForm({ title, fields, values = {}, submit = 'Save', onSubmit }) {
    formCtx = { fields, vals: { ...values }, onSubmit };
    $('form-title').textContent = title;
    $('form-submit').innerHTML = `<i class="fas fa-floppy-disk"></i> ${esc(submit)}`;
    $('form-error').hidden = true;
    drawForm();
    openModal('form-modal');
  }

  $('form-body').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('form-body').checkValidity()) { $('form-body').reportValidity(); return; }
    try {
      const msg = await formCtx.onSubmit(readForm());
      closeModal($('form-modal'));
      renderAll();
      if (msg) toast(msg);
    } catch (err) { showError('form-error', err.message || 'Something went wrong.'); }
  });

  async function run(fn, success) {
    try { await fn(); renderAll(); if (success) toast(success); return true; }
    catch (err) { toast(err.message || 'Something went wrong.', 'error'); return false; }
  }

  /* ---------- option lists ---------- */
  const deptOptions = () => state.departments.map((d) => [d.id, d.name]);
  const posOptions = (v) => state.positions.filter((p) => !v.department_id || p.department_id == v.department_id).map((p) => [p.id, p.title]);
  const empOptions = (list = state.employees) => list.map((e) => [e.id, `${fullName(e)} (${e.employee_no})`]);

  /* ---------- forms: employees ---------- */
  const employeeFields = () => [
    { name: 'first_name', label: 'First name', required: true, maxlength: 50 },
    { name: 'middle_name', label: 'Middle name', maxlength: 50 },
    { name: 'last_name', label: 'Last name', required: true, maxlength: 50 },
    { name: 'suffix', label: 'Suffix', placeholder: 'Jr., III (optional)', maxlength: 20 },
    { name: 'sex', label: 'Sex', type: 'select', options: ['Male', 'Female'], blank: 'Select', required: true },
    { name: 'birthday', label: 'Birthday', type: 'date', required: true, min: '1900-01-01', max: today() },
    { name: 'email', label: 'Email', type: 'email', required: true, maxlength: 100 },
    { name: 'phone', label: 'Phone', maxlength: 20 },
    { name: 'address', label: 'Address', full: true, maxlength: 200 },
    { name: 'department_id', label: 'Department', type: 'select', num: true, required: true, refresh: true, options: deptOptions, blank: 'Select department' },
    { name: 'position_id', label: 'Position', type: 'select', num: true, required: true, options: posOptions, blank: 'Select position' },
    { name: 'employment_type', label: 'Employment type', type: 'select', options: EMP_TYPES },
    { name: 'date_hired', label: 'Date hired', type: 'date', required: true },
    { name: 'status', label: 'Status', type: 'select', options: STATUSES },
    { name: 'emergency_name', label: 'Emergency contact', maxlength: 100 },
    { name: 'emergency_phone', label: 'Emergency phone', maxlength: 20 },
  ];

  function employeeForm(id) {
    const e = id ? emp(id) : null;
    openForm({
      title: e ? `Edit ${niceName(e)}` : 'Add Employee',
      fields: employeeFields(),
      values: e || { employment_type: 'Probationary', status: 'Active', date_hired: today() },
      submit: e ? 'Save changes' : 'Add employee',
      onSubmit: async (v) => {
        if (v.date_hired && v.birthday && v.date_hired < addMonths(v.birthday, 12 * 15)) throw new Error('Check the birthday and hire date. The employee would be under 15.');
        if (e) { await mutate('employees', 'update', { ...v, id: e.id }); return 'Employee updated.'; }
        await mutate('employees', 'create', v);
        return 'Employee added.';
      },
    });
  }

  function viewEmployee(id) {
    const e = emp(id);
    if (!e) return;
    const year = new Date().getFullYear();
    const bal = ['Vacation', 'Sick', 'Emergency'].map((t) => `<span class="chip">${t}: ${Math.max(0, entitlement(t) - leaveUsed(e.id, t, year))} / ${entitlement(t)} left</span>`).join('');
    const since = addDays(today(), -30);
    const att = state.attendance.filter((a) => a.employee_id == e.id && a.work_date >= since);
    const count = (s) => att.filter((a) => a.status === s).length;
    const reviews = state.reviews.filter((r) => r.employee_id == e.id);
    const trainings = state.trainings.filter((t) => (t.participants || []).includes(e.id));
    const procs = state.onboarding.filter((o) => o.employee_id == e.id);
    const tenure = diffDays(e.date_hired, today());
    const kv = (k, v) => `<div><span>${esc(k)}</span><strong>${esc(v || '-')}</strong></div>`;
    $('view-title').textContent = 'Employee Profile';
    $('view-body').innerHTML = `
      <div class="profile-head">
        <span class="avatar lg">${esc(initials(e))}</span>
        <div><h4>${esc(niceName(e))}</h4><span class="sub">${esc(posTitle(e.position_id))} &middot; ${esc(deptName(e.department_id))}</span><br>${badge(e.status)} ${badge(e.employment_type)}</div>
        <div class="profile-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-action="edit-employee" data-id="${e.id}"><i class="fas fa-pen"></i> Edit</button>
          <button type="button" class="btn btn-secondary btn-sm" data-action="add-leave" data-emp="${e.id}"><i class="fas fa-calendar-plus"></i> File leave</button>
          <button type="button" class="btn btn-danger btn-sm" data-action="start-offboarding" data-id="${e.id}"><i class="fas fa-door-open"></i> Offboard</button>
        </div>
      </div>
      <div class="kv">
        ${kv('Employee ID', e.employee_no)}${kv('Email', e.email)}${kv('Phone', e.phone)}${kv('Birthday', fmtDate(e.birthday))}${kv('Sex', e.sex)}
        ${kv('Date hired', fmtDate(e.date_hired))}${kv('Tenure', `${Math.floor(tenure / 365)} yr ${Math.floor((tenure % 365) / 30)} mo`)}${kv('Address', e.address)}
        ${kv('Emergency contact', e.emergency_name)}${kv('Emergency phone', e.emergency_phone)}
      </div>
      <h4 class="detail-title">Leave balance (${year})</h4><div class="chips">${bal}</div>
      <h4 class="detail-title">Attendance, last 30 days</h4>
      <div class="chips"><span class="chip">Present: ${count('present')}</span><span class="chip">Late: ${count('late')}</span><span class="chip">Half day: ${count('half_day')}</span><span class="chip">Absent: ${count('absent')}</span></div>
      <h4 class="detail-title">Performance reviews</h4>
      ${reviews.length ? `<div class="chips">${reviews.map((r) => `<span class="chip">${esc(r.period)}: ${r.rating ? r.rating + '/5' : 'draft'}</span>`).join('')}</div>` : '<p class="muted">No reviews yet.</p>'}
      <h4 class="detail-title">Training</h4>
      ${trainings.length ? `<div class="chips">${trainings.map((t) => `<span class="chip">${esc(t.title)} (${esc(t.status)})</span>`).join('')}</div>` : '<p class="muted">No trainings yet.</p>'}
      <h4 class="detail-title">Onboarding / offboarding</h4>
      ${procs.length ? `<div class="chips">${procs.map((o) => `<span class="chip">${esc(o.type)}: ${o.tasks.filter((t) => t.done).length}/${o.tasks.length} tasks</span>`).join('')}</div>` : '<p class="muted">No process on record.</p>'}`;
    openModal('view-modal');
  }

  /* ---------- forms: recruitment ---------- */
  function jobForm(id) {
    const j = id ? job(id) : null;
    openForm({
      title: j ? 'Edit Job Opening' : 'Post Job Opening',
      fields: [
        { name: 'title', label: 'Job title', required: true, maxlength: 100, full: true },
        { name: 'department_id', label: 'Department', type: 'select', num: true, required: true, options: deptOptions, blank: 'Select department' },
        { name: 'type', label: 'Employment type', type: 'select', options: EMP_TYPES },
        { name: 'openings', label: 'Openings', type: 'number', min: 1, max: 99, required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['Open', 'On Hold', 'Closed'] },
        { name: 'description', label: 'Description', type: 'textarea', maxlength: 500 },
      ],
      values: j || { type: 'Regular', openings: 1, status: 'Open' },
      submit: j ? 'Save changes' : 'Post job',
      onSubmit: async (v) => {
        if (j) { await mutate('jobs', 'update', { ...v, id: j.id }); return 'Job updated.'; }
        await mutate('jobs', 'create', { ...v, posted: today() });
        return 'Job posted.';
      },
    });
  }

  function applicantForm(id) {
    const a = id ? find('applicants', id) : null;
    openForm({
      title: a ? 'Edit Applicant' : 'Add Applicant',
      fields: [
        { name: 'job_id', label: 'Job', type: 'select', num: true, required: true, full: true, options: () => state.jobs.map((j) => [j.id, `${j.title} (${deptName(j.department_id)})`]), blank: 'Select job' },
        { name: 'first_name', label: 'First name', required: true, maxlength: 50 },
        { name: 'last_name', label: 'Last name', required: true, maxlength: 50 },
        { name: 'email', label: 'Email', type: 'email', required: true },
        { name: 'phone', label: 'Phone', maxlength: 20 },
        { name: 'source', label: 'Source', type: 'select', options: ['Website', 'Referral', 'JobStreet', 'LinkedIn', 'Walk-in', 'Other'] },
        { name: 'stage', label: 'Stage', type: 'select', options: STAGES.filter((s) => s !== 'Hired') },
        { name: 'interview_date', label: 'Interview date', type: 'date' },
        { name: 'notes', label: 'Notes', type: 'textarea', maxlength: 500 },
      ],
      values: a || { stage: 'Applied', source: 'Website', job_id: ui.job || '' },
      submit: a ? 'Save changes' : 'Add applicant',
      onSubmit: async (v) => {
        if (a) { await mutate('applicants', 'update', { ...v, id: a.id }); return 'Applicant updated.'; }
        await mutate('applicants', 'create', { ...v, applied: today() });
        return 'Applicant added.';
      },
    });
  }

  function hireForm(applicantId) {
    const a = find('applicants', applicantId);
    const j = job(a.job_id) || {};
    openForm({
      title: `Hire ${a.first_name} ${a.last_name}`,
      fields: [
        { name: 'department_id', label: 'Department', type: 'select', num: true, required: true, refresh: true, options: deptOptions, blank: 'Select department' },
        { name: 'position_id', label: 'Position', type: 'select', num: true, required: true, options: posOptions, blank: 'Select position' },
        { name: 'employment_type', label: 'Employment type', type: 'select', options: EMP_TYPES },
        { name: 'date_hired', label: 'Start date', type: 'date', required: true },
      ],
      values: { department_id: j.department_id || '', employment_type: j.type || 'Probationary', date_hired: today() },
      submit: 'Hire and start onboarding',
      onSubmit: async (v) => { await mutate('applicants', 'hire', { ...v, applicant_id: a.id }); return `${a.first_name} is now an employee. Onboarding started.`; },
    });
  }

  /* ---------- forms: onboarding ---------- */
  function processForm(empId, type) {
    openForm({
      title: 'Start Onboarding / Offboarding',
      fields: [
        { name: 'employee_id', label: 'Employee', type: 'select', num: true, required: true, full: true, options: () => empOptions(), blank: 'Select employee' },
        { name: 'type', label: 'Process', type: 'select', options: ['Onboarding', 'Offboarding'] },
      ],
      values: { employee_id: empId || '', type: type || 'Onboarding' },
      submit: 'Start',
      onSubmit: async (v) => { await mutate('onboarding', 'start', v); location.hash = 'onboarding'; return `${v.type} started.`; },
    });
  }

  /* ---------- forms: attendance ---------- */
  function attStatus(p) {
    if (p.status && p.status !== 'auto') return p.status;
    if (!p.time_in) return 'absent';
    const h = hoursBetween(p.time_in, p.time_out);
    if (h !== null && h < 5) return 'half_day';
    return p.time_in > addMin(S().work_start || '08:00', S().grace_minutes || 0) ? 'late' : 'present';
  }

  function attendanceForm(recId, empId) {
    const r = recId ? find('attendance', recId) : null;
    openForm({
      title: r ? 'Correct Attendance Record' : 'Add Attendance Record',
      fields: [
        { name: 'employee_id', label: 'Employee', type: 'select', num: true, required: true, full: true, options: () => empOptions(activeEmployees()), blank: 'Select employee' },
        { name: 'work_date', label: 'Date', type: 'date', required: true, max: today() },
        { name: 'status', label: 'Status', type: 'select', options: [['auto', 'Auto (from time in)'], ['present', 'Present'], ['late', 'Late'], ['half_day', 'Half Day'], ['absent', 'Absent']] },
        { name: 'time_in', label: 'Time in', type: 'time' },
        { name: 'time_out', label: 'Time out', type: 'time' },
        { name: 'remarks', label: 'Remarks', maxlength: 200, full: true },
      ],
      values: r ? { ...r, status: r.status } : { employee_id: empId || '', work_date: ui.attDate, status: 'auto' },
      submit: 'Save',
      onSubmit: async (v) => {
        if (v.time_in && v.time_out && v.time_out <= v.time_in) throw new Error('Time out must be after time in.');
        const status = attStatus(v);
        const existing = r || state.attendance.find((a) => a.employee_id == v.employee_id && a.work_date === v.work_date);
        const payload = { ...v, status };
        if (existing) await mutate('attendance', 'update', { ...payload, id: existing.id });
        else await mutate('attendance', 'create', payload);
        return 'Attendance saved.';
      },
    });
  }

  /* ---------- forms: leaves ---------- */
  function leaveForm(empId) {
    openForm({
      title: 'File Leave for Employee',
      fields: [
        { name: 'employee_id', label: 'Employee', type: 'select', num: true, required: true, full: true, options: () => empOptions(activeEmployees()), blank: 'Select employee' },
        { name: 'leave_type', label: 'Leave type', type: 'select', options: LEAVE_TYPES, full: true },
        { name: 'start_date', label: 'From', type: 'date', required: true },
        { name: 'end_date', label: 'To', type: 'date', required: true },
        { name: 'reason', label: 'Reason', type: 'textarea', maxlength: 300, required: true },
      ],
      values: { employee_id: empId || '', leave_type: 'Vacation', start_date: today(), end_date: today() },
      submit: 'Submit request',
      onSubmit: async (v) => { validateLeave(v); await mutate('leaves', 'create', v); return 'Leave request filed. It is now pending approval.'; },
    });
  }

  function reviewLeaveForm(id) {
    const l = find('leaves', id);
    const e = emp(l.employee_id);
    const ent = entitlement(l.leave_type);
    const left = ent === null ? 'no limit' : `${Math.max(0, ent - leaveUsed(l.employee_id, l.leave_type, l.start_date.slice(0, 4)))} day(s) left`;
    openForm({
      title: `Review leave: ${niceName(e)}`,
      fields: [
        { name: 'status', label: 'Decision', type: 'select', options: ['Approved', 'Rejected'], required: true },
        { name: 'remarks', label: 'Remarks (visible to the employee)', type: 'textarea', maxlength: 300 },
      ],
      values: { status: 'Approved', remarks: '' },
      submit: 'Save decision',
      onSubmit: async (v) => {
        if (v.status === 'Approved') validateLeave({ ...l });
        await mutate('leaves', 'review', { id: l.id, status: v.status, remarks: v.remarks });
        return `Leave ${v.status.toLowerCase()}.`;
      },
    });
    const note = document.createElement('p');
    note.className = 'muted full';
    note.style.gridColumn = '1 / -1';
    note.textContent = `${l.leave_type} leave, ${fmtDate(l.start_date)} to ${fmtDate(l.end_date)} (${leaveDays(l)} day/s). Balance: ${left}. Reason: ${l.reason}`;
    $('form-fields').prepend(note);
  }

  /* ---------- forms: performance ---------- */
  function reviewForm(id) {
    const r = id ? find('reviews', id) : null;
    openForm({
      title: r ? 'Edit Performance Review' : 'New Performance Review',
      fields: [
        { name: 'employee_id', label: 'Employee', type: 'select', num: true, required: true, full: true, options: () => empOptions(activeEmployees()), blank: 'Select employee' },
        { name: 'period', label: 'Review period', required: true, placeholder: 'e.g. H1 2026', maxlength: 30 },
        { name: 'reviewer', label: 'Reviewer', required: true, maxlength: 80 },
        { name: 'rating', label: 'Rating', type: 'select', num: true, options: [[0, 'Not rated yet'], [1, '1 - Poor'], [2, '2 - Needs improvement'], [3, '3 - Meets expectations'], [4, '4 - Exceeds'], [5, '5 - Outstanding']] },
        { name: 'status', label: 'Status', type: 'select', options: ['Draft', 'Completed'] },
        { name: 'strengths', label: 'Strengths', type: 'textarea', maxlength: 500 },
        { name: 'improvements', label: 'Areas to improve', type: 'textarea', maxlength: 500 },
        { name: 'goals', label: 'Goals for next period', type: 'textarea', maxlength: 500 },
      ],
      values: r || { rating: 0, status: 'Draft' },
      submit: 'Save review',
      onSubmit: async (v) => {
        if (v.status === 'Completed' && !v.rating) throw new Error('Give a rating before marking the review as completed.');
        if (r) { await mutate('reviews', 'update', { ...v, id: r.id }); return 'Review updated.'; }
        await mutate('reviews', 'create', v);
        return 'Review saved.';
      },
    });
  }

  function viewReview(id) {
    const r = find('reviews', id);
    $('view-title').textContent = 'Performance Review';
    $('view-body').innerHTML = `
      <div class="kv"><div><span>Employee</span><strong>${esc(niceName(emp(r.employee_id)))}</strong></div><div><span>Period</span><strong>${esc(r.period)}</strong></div>
      <div><span>Reviewer</span><strong>${esc(r.reviewer)}</strong></div><div><span>Rating</span><strong>${r.rating ? stars(r.rating) : 'Not rated'}</strong></div></div>
      <h4 class="detail-title">Strengths</h4><p>${esc(r.strengths || '-')}</p>
      <h4 class="detail-title">Areas to improve</h4><p>${esc(r.improvements || '-')}</p>
      <h4 class="detail-title">Goals</h4><p>${esc(r.goals || '-')}</p>`;
    openModal('view-modal');
  }

  /* ---------- forms: training, announcements, departments ---------- */
  function trainingForm(id) {
    const t = id ? find('trainings', id) : null;
    openForm({
      title: t ? 'Edit Training' : 'New Training',
      fields: [
        { name: 'title', label: 'Title', required: true, full: true, maxlength: 100 },
        { name: 'trainer', label: 'Trainer', required: true, maxlength: 80 },
        { name: 'venue', label: 'Venue', maxlength: 80 },
        { name: 'date', label: 'Date', type: 'date', required: true },
        { name: 'hours', label: 'Hours', type: 'number', min: 0.5, step: '0.5', required: true },
        { name: 'capacity', label: 'Capacity', type: 'number', min: 1, required: true },
        { name: 'status', label: 'Status', type: 'select', options: ['Upcoming', 'Ongoing', 'Completed'] },
      ],
      values: t || { status: 'Upcoming', capacity: 20, hours: 4, date: today() },
      submit: t ? 'Save changes' : 'Create training',
      onSubmit: async (v) => {
        if (t) {
          if (v.capacity < (t.participants || []).length) throw new Error(`Capacity cannot be lower than the ${t.participants.length} enrolled.`);
          await mutate('trainings', 'update', { ...v, id: t.id }); return 'Training updated.';
        }
        await mutate('trainings', 'create', { ...v, participants: [] });
        return 'Training created.';
      },
    });
  }

  function enrollForm(id) {
    const t = find('trainings', id);
    openForm({
      title: `Participants: ${t.title}`,
      fields: [{ name: 'participants', label: 'Employees', type: 'checks', hint: `(capacity ${t.capacity})`, options: () => empOptions(activeEmployees()) }],
      values: { participants: t.participants || [] },
      submit: 'Save participants',
      onSubmit: async (v) => {
        if (v.participants.length > t.capacity) throw new Error(`Only ${t.capacity} seats are available.`);
        await mutate('trainings', 'update', { id: t.id, participants: v.participants });
        return 'Participants updated.';
      },
    });
  }

  function announcementForm(id) {
    const a = id ? find('announcements', id) : null;
    openForm({
      title: a ? 'Edit Announcement' : 'Post Announcement',
      fields: [
        { name: 'title', label: 'Title', required: true, full: true, maxlength: 120 },
        { name: 'body', label: 'Message', type: 'textarea', required: true, maxlength: 1000 },
        { name: 'audience', label: 'Audience', type: 'select', options: () => ['All employees', ...state.departments.map((d) => d.name)] },
        { name: 'priority', label: 'Priority', type: 'select', options: ['Normal', 'Important'] },
      ],
      values: a || { audience: 'All employees', priority: 'Normal' },
      submit: a ? 'Save changes' : 'Post',
      onSubmit: async (v) => {
        if (a) { await mutate('announcements', 'update', { ...v, id: a.id }); return 'Announcement updated.'; }
        await mutate('announcements', 'create', { ...v, date: today(), pinned: false });
        return 'Announcement posted.';
      },
    });
  }

  function headForm(id) {
    const d = dept(id);
    openForm({
      title: `Department head: ${d.name}`,
      fields: [{ name: 'head_id', label: 'Head', type: 'select', num: true, full: true, blank: 'No head assigned',
        options: () => empOptions(activeEmployees().filter((e) => e.department_id == d.id)) }],
      values: { head_id: d.head_id || '' },
      submit: 'Save',
      onSubmit: async (v) => { await mutate('departments', 'update', { id: d.id, head_id: v.head_id }); return 'Department head updated.'; },
    });
  }

  /* ---------- CSV export ---------- */
  function download(name, rows) {
    const cell = (c) => { let s = String(c ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
    const blob = new Blob([`\ufeff${rows.map((r) => r.map(cell).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `${name}-${today()}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function exportData(what) {
    if (what === 'employees') {
      download('employees', [['Employee ID', 'Name', 'Email', 'Phone', 'Department', 'Position', 'Type', 'Date hired', 'Status']]
        .concat(state.employees.map((e) => [e.employee_no, niceName(e), e.email, e.phone, deptName(e.department_id), posTitle(e.position_id), e.employment_type, e.date_hired, e.status])));
    } else if (what === 'leaves') {
      download('leaves', [['ID', 'Employee', 'Type', 'From', 'To', 'Days', 'Reason', 'Status', 'Remarks']]
        .concat(state.leaves.map((l) => [l.id, niceName(emp(l.employee_id)), l.leave_type, l.start_date, l.end_date, leaveDays(l), l.reason, l.status, l.remarks])));
    } else if (what === 'attendance') {
      download('attendance', [['Employee', 'Department', 'Date', 'Time in', 'Time out', 'Status', 'Remarks']]
        .concat(state.attendance.filter((a) => a.work_date === ui.attDate).map((a) => { const e = emp(a.employee_id); return [niceName(e), e ? deptName(e.department_id) : '', a.work_date, a.time_in, a.time_out, ATT_LABEL[a.status], a.remarks]; })));
    }
  }

  /* ---------- rendering ---------- */
  function fillSelect(sel, firstLabel, items, selected) {
    sel.innerHTML = `<option value="">${esc(firstLabel)}</option>` + items.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('');
    sel.value = selected ?? '';
  }
  const tbody = (id) => $(id).querySelector('tbody');
  const btn = (action, id, text, cls = 'btn-secondary', icon = '', extra = '') =>
    `<button type="button" class="btn ${cls} btn-sm" data-action="${action}" data-id="${id}" ${extra}>${icon ? `<i class="fas ${icon}"></i>` : ''}${text ? ` ${text}` : ''}</button>`;
  const rowActions = (...b) => `<div class="row-actions">${b.join('')}</div>`;

  function renderDashboard() {
    const t = today();
    $('d-total').textContent = state.employees.length;
    $('d-active').textContent = state.employees.filter((e) => e.status === 'Active').length;
    $('d-onleave').textContent = onLeaveOn(t).length;
    $('d-jobs').textContent = sum(state.jobs.filter((j) => j.status === 'Open').map((j) => j.openings));
    $('d-applicants').textContent = state.applicants.filter((a) => a.stage === 'Applied').length;
    const pending = state.leaves.filter((l) => l.status === 'Pending');
    $('d-pending').textContent = pending.length;

    $('dash-leaves').innerHTML = pending.length ? pending.slice(0, 5).map((l) => `<li><div>${esc(niceName(emp(l.employee_id)))}<span class="sub">${esc(l.leave_type)} &middot; ${fmtDate(l.start_date)} to ${fmtDate(l.end_date)}</span></div>
      ${rowActions(btn('quick-leave', l.id, '', 'btn-primary', 'fa-check', 'data-decision="Approved" aria-label="Approve"'), btn('review-leave', l.id, '', 'btn-danger', 'fa-xmark', 'aria-label="Reject / review"'))}</li>`).join('') : emptyLi('No pending leave requests.');

    const news = [...state.announcements].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date)).slice(0, 3);
    $('dash-announcements').innerHTML = news.length ? news.map((a) => `<li><div>${a.pinned ? '<i class="fas fa-thumbtack"></i> ' : ''}${esc(a.title)}<span class="sub">${fmtDate(a.date)} &middot; ${esc(a.audience)}</span></div>${a.priority === 'Important' ? badge('Important') : ''}</li>`).join('') : emptyLi('No announcements.');

    const month = parse(t).getMonth();
    const live = activeEmployees();
    const bdays = live.filter((e) => e.birthday && parse(e.birthday).getMonth() === month).sort((a, b) => parse(a.birthday).getDate() - parse(b.birthday).getDate());
    $('dash-birthdays').innerHTML = bdays.length ? bdays.map((e) => `<li><span>${esc(niceName(e))}</span><span class="muted">${parse(e.birthday).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}</span></li>`).join('') : emptyLi('No birthdays this month.');

    const year = parse(t).getFullYear();
    const annivs = live.filter((e) => parse(e.date_hired).getMonth() === month && parse(e.date_hired).getFullYear() < year);
    $('dash-anniversaries').innerHTML = annivs.length ? annivs.map((e) => `<li><span>${esc(niceName(e))}</span><span class="muted">${year - parse(e.date_hired).getFullYear()} yr</span></li>`).join('') : emptyLi('No anniversaries this month.');

    const months = Number(S().probation_months) || 6;
    const prob = live.filter((e) => e.employment_type === 'Probationary').map((e) => ({ e, end: addMonths(e.date_hired, months) })).filter((x) => x.end <= addDays(t, 30)).sort((a, b) => a.end.localeCompare(b.end));
    $('dash-probation').innerHTML = prob.length ? prob.map(({ e, end }) => {
      const n = diffDays(t, end);
      return `<li><div>${esc(niceName(e))}<span class="sub">${n < 0 ? `Overdue by ${-n} day(s)` : n === 0 ? 'Due today' : `In ${n} day(s)`} &middot; ${fmtDate(end)}</span></div>${btn('regularize', e.id, 'Regularize', 'btn-primary')}</li>`;
    }).join('') : emptyLi('No one is due for regularization.');

    const counts = state.departments.map((d) => [d.name, state.employees.filter((e) => e.department_id === d.id && (e.status === 'Active' || e.status === 'On Leave')).length]);
    const max = Math.max(1, ...counts.map((c) => c[1]));
    $('dash-headcount').innerHTML = counts.length ? counts.map(([n, c]) => `<div class="bar-row"><span>${esc(n)}</span><div class="bar-track"><div class="bar-fill" style="width:${(c / max) * 100}%"></div></div><span class="n">${c}</span></div>`).join('') : '<p class="muted">No departments yet.</p>';
  }

  function filteredEmployees() {
    const q = ui.query.trim().toLowerCase();
    return state.employees.filter((e) =>
      (!q || [fullName(e), niceName(e), e.employee_no, e.email].some((v) => String(v).toLowerCase().includes(q))) &&
      (!ui.dept || e.department_id == ui.dept) && (!ui.status || e.status === ui.status) && (!ui.type || e.employment_type === ui.type));
  }

  function renderEmployees() {
    fillSelect($('f-emp-dept'), 'All departments', deptOptions(), ui.dept);
    fillSelect($('f-emp-type'), 'All types', EMP_TYPES.map((t) => [t, t]), ui.type);
    $('f-emp-status').value = ui.status;
    const list = filteredEmployees();
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    ui.page = Math.min(Math.max(1, ui.page), pages);
    const rows = list.slice((ui.page - 1) * PAGE_SIZE, ui.page * PAGE_SIZE);
    tbody('employees-table').innerHTML = rows.length ? rows.map((e) => `<tr><td>${person(e)}</td><td>${esc(e.employee_no)}</td><td>${esc(deptName(e.department_id))}</td><td>${esc(posTitle(e.position_id))}</td>
      <td>${badge(e.employment_type)}</td><td>${fmtDate(e.date_hired)}</td><td>${badge(e.status)}</td>
      <td>${rowActions(btn('view-employee', e.id, 'View', 'btn-primary', 'fa-eye'), btn('edit-employee', e.id, 'Edit', 'btn-secondary', 'fa-pen'))}</td></tr>`).join('') : emptyRow(8, 'No employees match your filters.');
    $('page-info').textContent = `Page ${ui.page} of ${pages}`;
    $('emp-count').textContent = `${list.length} employee${list.length === 1 ? '' : 's'}`;
    $('prev-page').disabled = ui.page <= 1;
    $('next-page').disabled = ui.page >= pages;
  }

  function renderRecruitment() {
    tbody('jobs-table').innerHTML = state.jobs.length ? state.jobs.map((j) => `<tr><td>${j.id}</td><td>${esc(j.title)}</td><td>${esc(deptName(j.department_id))}</td><td>${badge(j.type)}</td>
      <td class="num">${j.openings}</td><td class="num">${state.applicants.filter((a) => a.job_id === j.id).length}</td><td>${fmtDate(j.posted)}</td><td>${badge(j.status)}</td>
      <td>${rowActions(btn('edit-job', j.id, 'Edit', 'btn-secondary', 'fa-pen'), btn('delete-job', j.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete job"'))}</td></tr>`).join('') : emptyRow(9, 'No job openings yet.');

    fillSelect($('f-job'), 'All jobs', state.jobs.map((j) => [j.id, j.title]), ui.job);
    const apps = state.applicants.filter((a) => !ui.job || a.job_id == ui.job);
    $('board').innerHTML = STAGES.map((st) => {
      const col = apps.filter((a) => a.stage === st);
      return `<div class="column"><h4>${st} <span>${col.length}</span></h4><div class="cards">${col.length ? col.map((a) => `
        <div class="applicant"><strong>${esc(a.first_name)} ${esc(a.last_name)}</strong><span class="sub">${esc((job(a.job_id) || {}).title || '-')}</span>
        <span class="sub">${esc(a.email)}</span>${a.interview_date ? `<span class="sub"><i class="fas fa-calendar"></i> Interview ${fmtDate(a.interview_date)}</span>` : ''}
        <select data-move="${a.id}" aria-label="Move ${esc(a.first_name)} to stage">${STAGES.map((s) => `<option${s === a.stage ? ' selected' : ''}>${s}</option>`).join('')}</select>
        ${rowActions(btn('edit-applicant', a.id, 'Edit', 'btn-secondary', 'fa-pen'), btn('delete-applicant', a.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete applicant"'))}</div>`).join('') : '<p class="none">No applicants</p>'}</div></div>`;
    }).join('');
  }

  function renderOnboarding() {
    const list = state.onboarding.filter((o) => !ui.process || o.type === ui.process);
    $('f-process').value = ui.process;
    $('process-list').innerHTML = list.length ? list.map((o) => {
      const done = o.tasks.filter((t) => t.done).length;
      const pct = Math.round((done / o.tasks.length) * 100);
      const e = emp(o.employee_id);
      return `<article class="process"><div class="process-head"><div><strong>${esc(niceName(e))}</strong><span class="sub" style="display:block;color:#8aa596;font-size:.85rem">${esc(posTitle(e && e.position_id))} &middot; started ${fmtDate(o.started)}</span></div>
        <div>${badge(o.type)} ${badge(pct === 100 ? 'Completed' : 'In Progress')}</div></div>
        <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div style="width:${pct}%"></div></div>
        <ul class="checklist">${o.tasks.map((t, i) => `<li><label><input type="checkbox" data-task="${o.id}:${i}"${t.done ? ' checked' : ''}> <span class="${t.done ? 'done' : ''}">${esc(t.title)}</span></label></li>`).join('')}</ul>
        <div class="row-actions" style="margin-top:.8rem;justify-content:space-between"><span class="muted">${done} of ${o.tasks.length} done</span>${btn('delete-process', o.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete process"')}</div></article>`;
    }).join('') : '<p class="muted">No onboarding or offboarding processes yet.</p>';
  }

  function renderAttendance() {
    fillSelect($('a-dept'), 'All departments', deptOptions(), ui.attDept);
    $('a-date').value = ui.attDate;
    const inDept = (e) => !ui.attDept || (e && e.department_id == ui.attDept);
    const recs = state.attendance.filter((a) => a.work_date === ui.attDate && inDept(emp(a.employee_id)));
    const leaveIds = onLeaveOn(ui.attDate).map((l) => l.employee_id);
    const missing = activeEmployees().filter((e) => inDept(e) && !leaves_has(leaveIds, e.id) && !recs.some((r) => r.employee_id === e.id));
    const c = (s) => recs.filter((r) => r.status === s).length;
    $('a-present').textContent = c('present') + c('half_day');
    $('a-late').textContent = c('late');
    $('a-absent').textContent = c('absent');
    $('a-leave').textContent = leaveIds.filter((id) => inDept(emp(id))).length;

    const rows = recs.map((r) => {
      const e = emp(r.employee_id); const h = hoursBetween(r.time_in, r.time_out);
      return `<tr><td>${person(e || {})}</td><td>${esc(e ? deptName(e.department_id) : '-')}</td><td>${esc(r.time_in || '-')}</td><td>${esc(r.time_out || '-')}</td>
        <td class="num">${h === null ? '-' : h.toFixed(2)}</td><td>${badge(r.status)}</td><td>${esc(r.remarks || '')}</td>
        <td>${rowActions(btn('edit-attendance', r.id, 'Correct', 'btn-secondary', 'fa-pen'), btn('delete-attendance', r.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete record"'))}</td></tr>`;
    }).concat(missing.map((e) => `<tr><td>${person(e)}</td><td>${esc(deptName(e.department_id))}</td><td>-</td><td>-</td><td class="num">-</td><td><span class="badge">No record</span></td><td></td>
        <td>${rowActions(`<button type="button" class="btn btn-primary btn-sm" data-action="add-attendance" data-emp="${e.id}"><i class="fas fa-plus"></i> Record</button>`)}</td></tr>`));
    tbody('attendance-table').innerHTML = rows.length ? rows.join('') : emptyRow(8, 'No attendance for this date.');
  }
  const leaves_has = (ids, id) => ids.includes(id);

  function renderLeaves() {
    const count = (s) => state.leaves.filter((l) => l.status === s).length;
    $('l-pending').textContent = count('Pending'); $('l-approved').textContent = count('Approved'); $('l-rejected').textContent = count('Rejected');
    fillSelect($('f-leave-type'), 'All types', LEAVE_TYPES.map((t) => [t, t]), ui.leaveType);
    $('f-leave-status').value = ui.leaveStatus;
    const rows = state.leaves.filter((l) => (!ui.leaveStatus || l.status === ui.leaveStatus) && (!ui.leaveType || l.leave_type === ui.leaveType))
      .sort((a, b) => (a.status === 'Pending' ? -1 : 0) - (b.status === 'Pending' ? -1 : 0) || b.start_date.localeCompare(a.start_date));
    tbody('leaves-table').innerHTML = rows.length ? rows.map((l) => `<tr><td>${l.id}</td><td>${esc(niceName(emp(l.employee_id)))}</td><td>${esc(l.leave_type)}</td><td>${fmtDate(l.start_date)}</td><td>${fmtDate(l.end_date)}</td>
      <td class="num">${leaveDays(l)}</td><td title="${esc(l.reason)}">${esc((l.reason || '-').slice(0, 36))}</td><td>${badge(l.status)}${l.remarks ? ` <span class="muted" title="${esc(l.remarks)}"><i class="fas fa-comment"></i></span>` : ''}</td>
      <td>${l.status === 'Pending' ? rowActions(btn('review-leave', l.id, 'Review', 'btn-primary', 'fa-clipboard-check'), btn('delete-leave', l.id, '', 'btn-danger', 'fa-trash', 'aria-label="Cancel request"')) : '<span class="muted">Reviewed</span>'}</td></tr>`).join('') : emptyRow(9, 'No leave requests found.');

    const year = new Date().getFullYear();
    const left = (e, t) => Math.max(0, entitlement(t) - leaveUsed(e.id, t, year));
    tbody('balances-table').innerHTML = activeEmployees().length ? activeEmployees().map((e) => `<tr><td>${esc(fullName(e))}</td><td>${esc(deptName(e.department_id))}</td>
      <td class="num">${left(e, 'Vacation')} / ${entitlement('Vacation')}</td><td class="num">${left(e, 'Sick')} / ${entitlement('Sick')}</td><td class="num">${left(e, 'Emergency')} / ${entitlement('Emergency')}</td></tr>`).join('') : emptyRow(5, 'No employees.');

    const t = today();
    const out = state.leaves.filter((l) => l.status === 'Approved' && l.end_date >= t && l.start_date <= addDays(t, 30)).sort((a, b) => a.start_date.localeCompare(b.start_date));
    tbody('out-table').innerHTML = out.length ? out.map((l) => { const e = emp(l.employee_id);
      return `<tr><td>${esc(niceName(e))}</td><td>${esc(e ? deptName(e.department_id) : '-')}</td><td>${esc(l.leave_type)}</td><td>${fmtDate(l.start_date)}</td><td>${fmtDate(l.end_date)}</td><td>${fmtDate(addDays(l.end_date, 1))}</td></tr>`; }).join('') : emptyRow(6, 'Nobody is scheduled to be out.');
  }

  function renderPerformance() {
    const done = state.reviews.filter((r) => r.status === 'Completed' && r.rating);
    $('p-avg').textContent = done.length ? (sum(done.map((r) => r.rating)) / done.length).toFixed(1) : '-';
    $('p-done').textContent = state.reviews.filter((r) => r.status === 'Completed').length;
    $('p-draft').textContent = state.reviews.filter((r) => r.status === 'Draft').length;
    tbody('reviews-table').innerHTML = state.reviews.length ? state.reviews.map((r) => `<tr><td>${esc(niceName(emp(r.employee_id)))}</td><td>${esc(r.period)}</td><td>${esc(r.reviewer)}</td>
      <td>${r.rating ? stars(r.rating) : '<span class="muted">Not rated</span>'}</td><td>${badge(r.status)}</td>
      <td>${rowActions(btn('view-review', r.id, 'View', 'btn-primary', 'fa-eye'), btn('edit-review', r.id, 'Edit', 'btn-secondary', 'fa-pen'), btn('delete-review', r.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete review"'))}</td></tr>`).join('') : emptyRow(6, 'No reviews yet.');
  }

  function renderTraining() {
    tbody('training-table').innerHTML = state.trainings.length ? [...state.trainings].sort((a, b) => b.date.localeCompare(a.date)).map((t) => `<tr><td>${esc(t.title)}</td><td>${esc(t.trainer)}</td><td>${fmtDate(t.date)}</td>
      <td class="num">${t.hours}</td><td>${esc(t.venue || '-')}</td><td class="num">${(t.participants || []).length} / ${t.capacity}</td><td>${badge(t.status)}</td>
      <td>${rowActions(btn('enroll', t.id, 'Participants', 'btn-primary', 'fa-user-group'), btn('edit-training', t.id, '', 'btn-secondary', 'fa-pen', 'aria-label="Edit training"'), btn('delete-training', t.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete training"'))}</td></tr>`).join('') : emptyRow(8, 'No trainings yet.');
  }

  function renderAnnouncements() {
    const list = [...state.announcements].sort((a, b) => (b.pinned - a.pinned) || b.date.localeCompare(a.date));
    $('announcement-list').innerHTML = list.length ? list.map((a) => `<article class="announce ${a.priority === 'Important' ? 'important' : ''}"><h3>${a.pinned ? '<i class="fas fa-thumbtack"></i>' : ''}${esc(a.title)} ${a.priority === 'Important' ? badge('Important') : ''}</h3>
      <p>${esc(a.body)}</p><div class="meta"><span>${fmtDate(a.date)} &middot; ${esc(a.audience)}</span>
      ${rowActions(btn('pin-announcement', a.id, a.pinned ? 'Unpin' : 'Pin', 'btn-secondary', 'fa-thumbtack'), btn('edit-announcement', a.id, 'Edit', 'btn-secondary', 'fa-pen'), btn('delete-announcement', a.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete announcement"'))}</div></article>`).join('') : '<p class="muted">No announcements yet.</p>';
  }

  function renderDepartments() {
    tbody('departments-table').innerHTML = state.departments.length ? state.departments.map((d) => {
      const n = state.employees.filter((e) => e.department_id === d.id).length;
      return `<tr><td>${d.id}</td><td>${esc(d.name)}</td><td>${d.head_id ? esc(niceName(emp(d.head_id))) : '<span class="muted">None</span>'}</td><td class="num">${n}</td>
        <td class="num">${state.jobs.filter((j) => j.department_id === d.id && j.status === 'Open').length}</td>
        <td>${rowActions(btn('edit-head', d.id, 'Set head', 'btn-secondary', 'fa-user-tie'), btn('delete-department', d.id, '', 'btn-danger', 'fa-trash', `aria-label="Delete department" ${n ? 'disabled title="Move or remove its employees first"' : ''}`))}</td></tr>`;
    }).join('') : emptyRow(6, 'No departments yet.');
  }

  function renderReports() {
    const all = state.employees;
    const live = activeEmployees();
    const since = addDays(today(), -30);
    const recent = state.attendance.filter((a) => a.work_date >= since);
    const attended = recent.filter((a) => a.status !== 'absent').length;
    const left = all.filter((e) => e.status === 'Resigned' || e.status === 'Terminated').length;
    const tenure = live.length ? sum(live.map((e) => diffDays(e.date_hired, today()) / 365)) / live.length : 0;
    const kpi = (cls, h, v, icon) => `<div class="card ${cls}"><h3>${h}</h3><p>${v}</p><i class="fas ${icon} card-icon"></i></div>`;
    $('report-kpis').innerHTML = kpi('card-blue', 'Headcount', live.length, 'fa-users') + kpi('card-pink', 'Turnover rate', `${all.length ? Math.round((left / all.length) * 100) : 0}%`, 'fa-door-open') +
      kpi('card-purple', 'Average tenure', `${tenure.toFixed(1)} yrs`, 'fa-hourglass-half') + kpi('card-green', 'Attendance rate (30d)', recent.length ? `${Math.round((attended / recent.length) * 100)}%` : '-', 'fa-user-check');

    const box = (title, head, rows) => `<section class="report-box"><h3>${title}</h3><table><thead><tr>${head.map((h, i) => `<th${i ? ' class="num"' : ''}>${h}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.join('') : emptyRow(head.length, 'No data yet.')}</tbody></table></section>`;
    const tr = (...c) => `<tr>${c.map((x, i) => `<td${i ? ' class="num"' : ''}>${x}</td>`).join('')}</tr>`;
    const by = (key, vals) => vals.map((v) => tr(esc(label(v)), all.filter((e) => e[key] === v).length));
    const leaveRows = LEAVE_TYPES.map((t) => { const l = state.leaves.filter((x) => x.leave_type === t); return l.length ? tr(t, l.filter((x) => x.status === 'Pending').length, l.filter((x) => x.status === 'Approved').length, sum(l.filter((x) => x.status === 'Approved').map(leaveDays))) : ''; }).filter(Boolean);
    $('report-grid').innerHTML =
      box('Headcount by Department', ['Department', 'Total', 'Active'], state.departments.map((d) => tr(esc(d.name), all.filter((e) => e.department_id === d.id).length, all.filter((e) => e.department_id === d.id && e.status === 'Active').length))) +
      box('Employees by Status', ['Status', 'Employees'], by('status', STATUSES)) +
      box('Employees by Type', ['Type', 'Employees'], by('employment_type', EMP_TYPES)) +
      box('Gender Distribution', ['Sex', 'Employees'], ['Female', 'Male'].map((s) => tr(s, all.filter((e) => e.sex === s).length))) +
      box('Leave Utilization', ['Type', 'Pending', 'Approved', 'Days taken'], leaveRows) +
      box('Recruitment Funnel', ['Stage', 'Applicants'], STAGES.map((s) => tr(s, state.applicants.filter((a) => a.stage === s).length))) +
      box('Attendance, last 30 days', ['Status', 'Records'], Object.keys(ATT_LABEL).map((s) => tr(ATT_LABEL[s], recent.filter((a) => a.status === s).length))) +
      box('Training Participation', ['Training', 'Enrolled'], state.trainings.map((t) => tr(esc(t.title), (t.participants || []).length)));
  }

  function renderSettings() {
    ['settings-schedule', 'settings-policy'].forEach((id) => [...$(id).elements].forEach((el) => { if (el.name && S()[el.name] !== undefined) el.value = S()[el.name]; }));
    const hol = [...(S().holidays || [])].sort((a, b) => a.date.localeCompare(b.date));
    $('holiday-list').innerHTML = hol.length ? hol.map((h) => `<li><span>${esc(h.name)} <span class="muted">${fmtDate(h.date)}</span></span>${btn('delete-holiday', h.id, '', 'btn-danger', 'fa-trash', 'aria-label="Delete holiday"')}</li>`).join('') : emptyLi('No holidays added.');
  }

  function renderChrome() {
    const t = today();
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    $('h-dashboard').textContent = `${greet}, ${me.name.split(' ')[0]}`;
    $('hero-date').textContent = parse(t).toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

    const pending = state.leaves.filter((l) => l.status === 'Pending').length;
    const fresh = state.applicants.filter((a) => a.stage === 'Applied').length;
    const months = Number(S().probation_months) || 6;
    const prob = activeEmployees().filter((e) => e.employment_type === 'Probationary' && addMonths(e.date_hired, months) <= addDays(t, 30)).length;
    const drafts = state.reviews.filter((r) => r.status === 'Draft').length;
    const soon = state.trainings.filter((x) => x.status === 'Upcoming' && x.date >= t && x.date <= addDays(t, 7)).length;
    const openProc = state.onboarding.filter((o) => o.tasks.some((k) => !k.done)).length;

    const bits = [];
    if (pending) bits.push(`${pending} leave request${pending > 1 ? 's' : ''}`);
    if (fresh) bits.push(`${fresh} new applicant${fresh > 1 ? 's' : ''}`);
    if (prob) bits.push(`${prob} probation review${prob > 1 ? 's' : ''}`);
    $('hero-sub').textContent = bits.length ? `Waiting for you: ${bits.join(', ')}.` : 'You are all caught up. Nothing needs your attention right now.';

    const items = [
      [pending, 'fa-calendar-check', `${pending} leave request${pending > 1 ? 's' : ''} to review`, '#leaves'],
      [fresh, 'fa-file-lines', `${fresh} new applicant${fresh > 1 ? 's' : ''} to screen`, '#recruitment'],
      [prob, 'fa-user-clock', `${prob} employee${prob > 1 ? 's' : ''} due for regularization`, '#dashboard'],
      [drafts, 'fa-pen-ruler', `${drafts} performance review draft${drafts > 1 ? 's' : ''}`, '#performance'],
      [soon, 'fa-graduation-cap', `${soon} training${soon > 1 ? 's' : ''} starting this week`, '#training'],
    ].filter((i) => i[0]);
    const total = sum(items.map((i) => i[0]));
    $('notif-count').textContent = total > 99 ? '99+' : total;
    $('notif-count').hidden = !total;
    $('notif-panel').innerHTML = `<h4>Needs your attention</h4>${items.length ? items.map(([, icon, text, href]) =>
      `<a href="${href}"><span class="ico"><i class="fas ${icon}"></i></span><span>${esc(text)}</span></a>`).join('') : '<p class="none">You are all caught up.</p>'}`;

    const setCount = (id, n) => { $(id).textContent = n; $(id).hidden = !n; };
    setCount('nc-leaves', pending); setCount('nc-recruitment', fresh); setCount('nc-onboarding', openProc);
  }

  function renderAll() {
    renderChrome();
    renderDashboard(); renderEmployees(); renderRecruitment(); renderOnboarding(); renderAttendance(); renderLeaves();
    renderPerformance(); renderTraining(); renderAnnouncements(); renderDepartments(); renderReports(); renderSettings();
  }

  /* ---------- routing ---------- */
  function route() {
    const name = location.hash.slice(1);
    const section = SECTIONS.includes(name) ? name : 'dashboard';
    SECTIONS.forEach((s) => $(`page-${s}`).classList.toggle('active', s === section));
    document.querySelectorAll('#nav li').forEach((li) => {
      const a = li.querySelector('a'); const on = a.dataset.section === section;
      li.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    document.title = `${TITLES[section]} | HR | Biri-Go`;
    document.body.classList.remove('nav-open');
    $('menu-btn').setAttribute('aria-expanded', 'false');
    $('notif-panel').hidden = true;
    $('notif-btn').setAttribute('aria-expanded', 'false');
    $('main').scrollTop = 0;
  }

  /* ---------- events ---------- */
  document.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) {
      const group = tab.closest('[data-tabs]').dataset.tabs;
      document.querySelectorAll(`[data-tabs="${group}"] .tab`).forEach((t) => t.classList.toggle('active', t === tab));
      document.querySelectorAll(`[data-panel^="${group}:"]`).forEach((p) => p.classList.toggle('active', p.dataset.panel === `${group}:${tab.dataset.tab}`));
      return;
    }
    const quick = e.target.closest('[data-quick]');
    if (quick) {
      const q = quick.dataset.quick;
      if (q.startsWith('status:')) { ui.status = q.slice(7); ui.page = 1; renderEmployees(); }
      if (q === 'pending') { ui.leaveStatus = 'Pending'; renderLeaves(); }
    }
    if (e.target.closest('[data-close]')) return closeModal(e.target.closest('.modal'));
    if (e.target.classList.contains('modal')) return closeModal(e.target);

    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) return;
    const id = +b.dataset.id;
    const act = b.dataset.action;
    const closeView = () => { if (!$('view-modal').hidden) { $('view-modal').hidden = true; } };
    const ask = (msg, fn, ok) => { if (confirm(msg)) run(fn, ok); };

    switch (act) {
      case 'add-employee': return employeeForm();
      case 'edit-employee': closeView(); return employeeForm(id);
      case 'view-employee': return viewEmployee(id);
      case 'start-offboarding': closeView(); return processForm(id, 'Offboarding');
      case 'regularize': return ask(`Make ${niceName(emp(id))} a regular employee?`, () => mutate('employees', 'update', { id, employment_type: 'Regular' }), 'Employee regularized.');
      case 'add-job': return jobForm();
      case 'edit-job': return jobForm(id);
      case 'delete-job': return ask('Delete this job opening? Its applicants will stay in the pipeline.', () => mutate('jobs', 'delete', { id }), 'Job deleted.');
      case 'add-applicant': return applicantForm();
      case 'edit-applicant': return applicantForm(id);
      case 'delete-applicant': return ask('Delete this applicant?', () => mutate('applicants', 'delete', { id }), 'Applicant deleted.');
      case 'start-process': return processForm();
      case 'delete-process': return ask('Delete this checklist?', () => mutate('onboarding', 'delete', { id }), 'Checklist deleted.');
      case 'add-attendance': closeView(); return attendanceForm(null, +b.dataset.emp || '');
      case 'edit-attendance': return attendanceForm(id);
      case 'delete-attendance': return ask('Delete this attendance record?', () => mutate('attendance', 'delete', { id }), 'Record deleted.');
      case 'add-leave': closeView(); return leaveForm(+b.dataset.emp || '');
      case 'review-leave': return reviewLeaveForm(id);
      case 'quick-leave': return run(async () => { validateLeave({ ...find('leaves', id) }); await mutate('leaves', 'review', { id, status: b.dataset.decision, remarks: '' }); }, 'Leave approved.');
      case 'delete-leave': return ask('Cancel this leave request?', () => mutate('leaves', 'delete', { id }), 'Request cancelled.');
      case 'add-review': return reviewForm();
      case 'edit-review': return reviewForm(id);
      case 'view-review': return viewReview(id);
      case 'delete-review': return ask('Delete this review?', () => mutate('reviews', 'delete', { id }), 'Review deleted.');
      case 'add-training': return trainingForm();
      case 'edit-training': return trainingForm(id);
      case 'enroll': return enrollForm(id);
      case 'delete-training': return ask('Delete this training?', () => mutate('trainings', 'delete', { id }), 'Training deleted.');
      case 'add-announcement': return announcementForm();
      case 'edit-announcement': return announcementForm(id);
      case 'pin-announcement': return run(() => mutate('announcements', 'update', { id, pinned: !find('announcements', id).pinned }));
      case 'delete-announcement': return ask('Delete this announcement?', () => mutate('announcements', 'delete', { id }), 'Announcement deleted.');
      case 'edit-head': return headForm(id);
      case 'delete-department': return ask(`Delete the ${deptName(id)} department?`, () => mutate('departments', 'delete', { id }), 'Department deleted.');
      case 'delete-holiday': return run(() => mutate('holidays', 'delete', { id }), 'Holiday removed.');
      case 'export': return exportData(b.dataset.what);
      case 'print': return window.print();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target.dataset.move) {
      const id = +e.target.dataset.move; const stage = e.target.value;
      if (stage === 'Hired') { e.target.value = find('applicants', id).stage; hireForm(id); return; }
      run(() => mutate('applicants', 'move', { id, stage }), `Moved to ${stage}.`);
    } else if (e.target.dataset.task) {
      const [id, index] = e.target.dataset.task.split(':').map(Number);
      run(() => mutate('onboarding', 'toggle', { id, index }));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(closeModal);
  });
  window.addEventListener('hashchange', route);

  $('menu-btn').addEventListener('click', () => {
    const open = document.body.classList.toggle('nav-open');
    $('menu-btn').setAttribute('aria-expanded', String(open));
  });
  $('notif-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = $('notif-panel');
    panel.hidden = !panel.hidden;
    $('notif-btn').setAttribute('aria-expanded', String(!panel.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.notif-wrap')) { $('notif-panel').hidden = true; $('notif-btn').setAttribute('aria-expanded', 'false'); }
  });
  $('notif-panel').addEventListener('click', (e) => {
    const a = e.target.closest('a');
    if (a && a.getAttribute('href') === location.hash) route();
  });

  $('search-input').addEventListener('input', () => { ui.query = $('search-input').value; ui.page = 1; renderEmployees(); });
  $('search-form').addEventListener('submit', (e) => { e.preventDefault(); ui.query = $('search-input').value; ui.page = 1; location.hash = 'employees'; renderEmployees(); });

  const bind = (id, key, after) => $(id).addEventListener('change', (e) => { ui[key] = e.target.value; ui.page = 1; after(); });
  bind('f-emp-dept', 'dept', renderEmployees); bind('f-emp-status', 'status', renderEmployees); bind('f-emp-type', 'type', renderEmployees);
  bind('f-job', 'job', renderRecruitment); bind('f-process', 'process', renderOnboarding);
  bind('f-leave-status', 'leaveStatus', renderLeaves); bind('f-leave-type', 'leaveType', renderLeaves);
  bind('a-dept', 'attDept', renderAttendance);
  $('a-date').addEventListener('change', (e) => { ui.attDate = e.target.value || today(); renderAttendance(); });
  $('a-today').addEventListener('click', () => { ui.attDate = today(); renderAttendance(); });
  $('f-emp-reset').addEventListener('click', () => { ui.dept = ui.status = ui.type = ui.query = ''; $('search-input').value = ''; ui.page = 1; renderEmployees(); });
  $('prev-page').addEventListener('click', () => { ui.page -= 1; renderEmployees(); });
  $('next-page').addEventListener('click', () => { ui.page += 1; renderEmployees(); });

  $('dept-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('dept-name').value.trim();
    if (name && await run(() => mutate('departments', 'create', { name, head_id: null }), 'Department added.')) $('dept-name').value = '';
  });
  ['settings-schedule', 'settings-policy'].forEach((id) => $(id).addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData($(id)).entries());
    Object.keys(data).forEach((k) => { if (k !== 'work_start' && k !== 'work_end') data[k] = Number(data[k]); });
    run(() => mutate('settings', 'save', data), 'Settings saved.');
  }));
  $('holiday-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await run(() => mutate('holidays', 'create', { name: $('hol-name').value.trim(), date: $('hol-date').value }), 'Holiday added.')) { $('hol-name').value = ''; $('hol-date').value = ''; }
  });

  /* ---------- start ---------- */
  document.addEventListener('DOMContentLoaded', async () => {
    await load();
    renderAll();
    route();
  });
})();