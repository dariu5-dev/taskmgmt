// ─────────────────────────────────────────────
//  Config
// ─────────────────────────────────────────────
const API_BASE = 'http://localhost:8000';

// ─────────────────────────────────────────────
//  State
// ─────────────────────────────────────────────
const state = {
  tasks: [],
  todayPlan: { id: null, plan_date: '', must_do_task_ids: [], must_do_tasks: [] },
  activeTab: 'all',
  completionFilter: 'incomplete',
  energyFilter: '',
  expandedTaskId: null,
  rolloverTasks: [],
  rolloverDismissed: false,
  notifiedTaskIds: new Set(),
};

// drag-and-drop for must-do slots
const drag = { srcIndex: null };

// ─────────────────────────────────────────────
//  API
// ─────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json();
}

const api = {
  getTasks:        ()         => apiFetch('/tasks/'),
  createTask:      (data)     => apiFetch('/tasks/', { method: 'POST', body: JSON.stringify(data) }),
  updateTask:      (id, data) => apiFetch(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTask:      (id)       => apiFetch(`/tasks/${id}`, { method: 'DELETE' }),
  completeTask:    (id)       => apiFetch(`/tasks/${id}/complete`, { method: 'POST' }),
  getTodayPlan:    ()         => apiFetch('/plans/today'),
  getPlanByDate:   (date)     => apiFetch(`/plans/date/${date}`),
  setMustDos:      (ids)      => apiFetch('/plans/today/must-dos', { method: 'PUT', body: JSON.stringify({ task_ids: ids }) }),
};

// ─────────────────────────────────────────────
//  Display helpers
// ─────────────────────────────────────────────
const ENERGY_META = {
  deep_focus: { label: 'DEEP',  cls: 'badge-deep',   color: 'var(--cyan)' },
  medium:     { label: 'MED',   cls: 'badge-medium',  color: 'var(--purple)' },
  quick_win:  { label: 'QUICK', cls: 'badge-quick',   color: 'var(--accent)' },
  mindless:   { label: 'MIND',  cls: 'badge-mind',    color: 'var(--muted)' },
};

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function energyBadge(level) {
  if (!level) return '';
  const m = ENERGY_META[level];
  return `<span class="badge ${m.cls}">${m.label}</span>`;
}

function dreadBar(score) {
  if (!score) return '';
  const color = score <= 2 ? 'var(--accent)' : score === 3 ? 'var(--yellow)' : 'var(--red)';
  return `<span class="dread-bar" style="color:${color}" title="Dread ${score}/5">${'■'.repeat(score)}${'□'.repeat(5 - score)}</span>`;
}

function dueDateLabel(task) {
  const raw = task.is_recurring ? task.next_due_at : task.due_date;
  if (!raw) return '';
  const due   = new Date(raw);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
  const diff  = Math.round((dueDay - today) / 86400000);
  if (diff < 0)  return `<span class="due-label due-overdue">${Math.abs(diff)}d overdue</span>`;
  if (diff === 0) return `<span class="due-label due-today">due today</span>`;
  if (diff === 1) return `<span class="due-label">tomorrow</span>`;
  return `<span class="due-label">in ${diff}d</span>`;
}

function streakBadge(task) {
  if (!task.is_recurring) return '';
  return task.current_streak > 0
    ? `<span class="streak-badge">🔥 ${task.current_streak}</span>`
    : `<span class="streak-badge" style="color:var(--muted)">❄ 0</span>`;
}

// ─────────────────────────────────────────────
//  Streak heat
// ─────────────────────────────────────────────
function getHeat(task) {
  if (!task.is_recurring || !task.last_completed_at || !task.next_due_at) return 1;
  const now    = Date.now();
  const last   = new Date(task.last_completed_at).getTime();
  const next   = new Date(task.next_due_at).getTime();
  const period = next - last;
  return period <= 0 ? 0 : Math.max(0, Math.min(1, 1 - (now - last) / period));
}

function heatColor(h) {
  if (h > 0.6)  return 'var(--accent)';
  if (h > 0.35) return 'var(--yellow)';
  if (h > 0.1)  return 'var(--orange)';
  return 'var(--red)';
}

function heatBar(h) {
  const filled = Math.round(h * 20);
  return `<span class="heat-bar" style="color:${heatColor(h)}">${'█'.repeat(filled)}${'░'.repeat(20 - filled)}</span>`;
}

function timeUntilDue(task) {
  if (!task.next_due_at) return '';
  const ms = new Date(task.next_due_at).getTime() - Date.now();
  if (ms < 0) return `<span style="color:var(--red)">OVERDUE</span>`;
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─────────────────────────────────────────────
//  Task card
// ─────────────────────────────────────────────
function taskCardHTML(task, opts = {}) {
  const { showPin = false, pinned = false } = opts;
  const isExpanded = state.expandedTaskId === task.id;

  const actions = [];
  if (showPin) {
    actions.push(`<button class="action-btn ${pinned ? 'pin pinned' : 'pin'}" data-action="pin" data-id="${task.id}" title="${pinned ? 'Unpin' : 'Pin as must-do'}">◈</button>`);
  }
  actions.push(`<button class="action-btn focus-action" data-action="focus" data-id="${task.id}" title="Focus mode">◉</button>`);
  actions.push(`<button class="action-btn" data-action="edit" data-id="${task.id}" title="Edit">✎</button>`);
  actions.push(`<button class="action-btn delete" data-action="delete" data-id="${task.id}" title="Delete">✕</button>`);

  const expandPanel = isExpanded ? `
    <div class="task-expand">
      <textarea class="expand-desc" id="expand-desc-${task.id}" placeholder="Add notes...">${escHtml(task.description || '')}</textarea>
      <div class="expand-actions">
        <button class="expand-focus-btn" data-action="focus" data-id="${task.id}">◉ FOCUS MODE</button>
        <button class="btn-ghost" style="font-size:11px;padding:5px 12px" data-action="save-desc" data-id="${task.id}">SAVE</button>
      </div>
    </div>` : '';

  return `
    <div class="task-card${task.completed ? ' completed' : ''}${isExpanded ? ' expanded' : ''}" data-id="${task.id}">
      <input type="checkbox" class="task-checkbox" data-action="complete" data-id="${task.id}" ${task.completed ? 'checked' : ''} />
      <div class="task-body">
        <div class="task-title-row">
          <span class="task-title" data-action="expand" data-id="${task.id}">${escHtml(task.title)}</span>
          <span class="expand-chevron${isExpanded ? ' open' : ''}" data-action="expand" data-id="${task.id}">▶</span>
        </div>
        <div class="task-meta">
          ${energyBadge(task.energy_level)}
          ${dreadBar(task.dread_score)}
          ${dueDateLabel(task)}
          ${streakBadge(task)}
          ${task.is_recurring ? `<span class="badge-recurring">${(task.recurrence_pattern || '').toUpperCase()}</span>` : ''}
        </div>
        ${expandPanel}
      </div>
      <div class="task-actions">${actions.join('')}</div>
    </div>`;
}

// ─────────────────────────────────────────────
//  Render: All Tasks
// ─────────────────────────────────────────────
function renderAllTasks() {
  document.getElementById('toolbar').innerHTML = `
    <button class="btn-primary" id="add-task-btn">+ ADD TASK</button>
    <div class="energy-filters">
      ${Object.entries(ENERGY_META).map(([k, m]) =>
        `<button class="energy-chip ${state.energyFilter === k ? 'active' : ''}"
          style="border-color:${m.color};color:${m.color}" data-energy="${k}">${m.label}</button>`
      ).join('')}
    </div>
    <div class="filter-group">
      <button class="filter-btn ${state.completionFilter === 'incomplete' ? 'active' : ''}" data-filter="incomplete">ACTIVE</button>
      <button class="filter-btn ${state.completionFilter === 'all'        ? 'active' : ''}" data-filter="all">ALL</button>
      <button class="filter-btn ${state.completionFilter === 'complete'   ? 'active' : ''}" data-filter="complete">DONE</button>
    </div>`;

  let tasks = [...state.tasks];
  if (state.completionFilter === 'incomplete') tasks = tasks.filter(t => !t.completed);
  if (state.completionFilter === 'complete')   tasks = tasks.filter(t => t.completed);
  if (state.energyFilter) tasks = tasks.filter(t => t.energy_level === state.energyFilter);
  tasks.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    return (b.dread_score || 0) - (a.dread_score || 0);
  });

  const main = document.getElementById('main');
  main.innerHTML = tasks.length
    ? `<div class="task-list">${tasks.map(t => taskCardHTML(t)).join('')}</div>`
    : `<div class="empty-state">— no tasks —</div>`;
}

// ─────────────────────────────────────────────
//  Render: Today's Plan
// ─────────────────────────────────────────────
function renderTodayPlan() {
  document.getElementById('toolbar').innerHTML =
    `<button class="btn-primary" id="add-task-btn">+ ADD TASK</button>`;

  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tmrw  = new Date(today.getTime() + 86400000);

  const overdue = state.tasks.filter(t => {
    if (t.completed) return false;
    const ref = t.is_recurring ? t.next_due_at : t.due_date;
    return ref && new Date(ref) < today;
  });

  const dueToday = state.tasks.filter(t => {
    if (t.completed) return false;
    const ref = t.is_recurring ? t.next_due_at : t.due_date;
    if (!ref) return false;
    const d = new Date(ref);
    return d >= today && d < tmrw;
  });

  const mustDoIds = state.todayPlan.must_do_task_ids || [];
  let html = '';

  // Rollover banner
  if (!state.rolloverDismissed && state.rolloverTasks.length) {
    const names = state.rolloverTasks.map(t => escHtml(t.title)).join(', ');
    html += `
      <div class="rollover-banner">
        <span class="rollover-text">⚠ Yesterday: <strong>${state.rolloverTasks.length}</strong> must-do${state.rolloverTasks.length > 1 ? 's' : ''} left undone — ${names}</span>
        <div class="rollover-actions">
          <button class="btn-primary" style="font-size:10px;padding:5px 12px" id="rollover-carry">CARRY FORWARD</button>
          <button class="btn-ghost"   style="font-size:10px;padding:5px 10px" id="rollover-dismiss">DISMISS</button>
        </div>
      </div>`;
  }

  // Overdue
  html += `<div class="section-header overdue">OVERDUE (${overdue.length})</div>`;
  html += overdue.length
    ? `<div class="task-list">${overdue.map(t => taskCardHTML(t, { showPin: true, pinned: mustDoIds.includes(t.id) })).join('')}</div>`
    : `<div class="empty-state">— none —</div>`;

  // Due today
  html += `<div class="section-header today">DUE TODAY (${dueToday.length})</div>`;
  html += dueToday.length
    ? `<div class="task-list">${dueToday.map(t => taskCardHTML(t, { showPin: true, pinned: mustDoIds.includes(t.id) })).join('')}</div>`
    : `<div class="empty-state">— nothing due today —</div>`;

  // Must-dos
  html += `<div class="section-header mustdo">YOUR 3 MUST-DOS</div>`;
  html += `<div class="mustdo-slots">`;
  for (let i = 0; i < 3; i++) {
    const tid  = mustDoIds[i];
    const task = tid ? state.tasks.find(t => t.id === tid) : null;
    if (task) {
      html += `
        <div class="mustdo-slot filled" draggable="true" data-mustdo-index="${i}">
          <span class="drag-handle" title="Drag to reorder">⠿</span>
          <span class="mustdo-num">[${i + 1}]</span>
          <input type="checkbox" class="task-checkbox" data-action="complete" data-id="${task.id}" ${task.completed ? 'checked' : ''} />
          <span class="mustdo-title">${escHtml(task.title)}</span>
          <button class="action-btn pin pinned" data-action="unpin" data-id="${task.id}" title="Remove">✕</button>
        </div>`;
    } else {
      html += `
        <div class="mustdo-slot" data-mustdo-index="${i}">
          <span class="drag-handle" style="visibility:hidden">⠿</span>
          <span class="mustdo-num">[${i + 1}]</span>
          <span class="mustdo-empty">click ◈ on a task above to pin here</span>
        </div>`;
    }
  }
  html += `</div>`;

  if (!overdue.length && !dueToday.length) {
    html += `<p class="hint">Tasks with a due date appear here. <a id="hint-add-link">Add one →</a></p>`;
  }

  document.getElementById('main').innerHTML = html;
}

// ─────────────────────────────────────────────
//  Render: Streaks
// ─────────────────────────────────────────────
function renderStreaks() {
  document.getElementById('toolbar').innerHTML =
    `<button class="btn-primary" id="add-task-btn">+ ADD TASK</button>`;

  const recurring = [...state.tasks]
    .filter(t => t.is_recurring)
    .sort((a, b) => getHeat(a) - getHeat(b));

  const main = document.getElementById('main');
  if (!recurring.length) {
    main.innerHTML = `<div class="empty-state">— no recurring tasks yet —<br><span style="font-size:11px;color:var(--muted)">Create a task and set a recurrence to start tracking streaks.</span></div>`;
    return;
  }

  main.innerHTML = recurring.map(task => {
    const h      = getHeat(task);
    const n      = task.current_streak;
    const streak = n > 0
      ? `<span class="streak-count">🔥 ${n} day${n !== 1 ? 's' : ''}</span>`
      : `<span class="streak-count cold">❄ 0 days</span>`;
    const best = task.longest_streak > 0
      ? `<span class="muted" style="font-size:11px"> / best: ${task.longest_streak}</span>` : '';

    return `
      <div class="streak-card">
        <div class="streak-top">
          <span class="streak-title">${escHtml(task.title)}</span>
          <span>${streak}${best}</span>
        </div>
        <div class="streak-row">
          <span class="streak-pattern">${(task.recurrence_pattern || '').toUpperCase()}</span>
          ${heatBar(h)}
          <span class="streak-meta" style="color:${heatColor(h)}">${timeUntilDue(task)}</span>
        </div>
        ${task.energy_level || task.dread_score ? `
        <div class="task-meta" style="margin-top:6px">
          ${energyBadge(task.energy_level)}${dreadBar(task.dread_score)}
        </div>` : ''}
      </div>`;
  }).join('');
}

// ─────────────────────────────────────────────
//  Render dispatcher
// ─────────────────────────────────────────────
function render() {
  if (state.activeTab === 'all')     renderAllTasks();
  else if (state.activeTab === 'today')   renderTodayPlan();
  else if (state.activeTab === 'streaks') renderStreaks();
}

// ─────────────────────────────────────────────
//  Modal
// ─────────────────────────────────────────────
function openModal(task = null) {
  const overlay = document.getElementById('modal-overlay');
  document.getElementById('task-form').reset();
  document.querySelectorAll('.dread-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('f-dread').value = '';
  document.getElementById('f-reminder-config').classList.add('hidden');

  const isEdit = !!task;
  document.getElementById('modal-title').textContent  = isEdit ? 'EDIT TASK' : '+ NEW TASK';
  document.getElementById('modal-submit').textContent = isEdit ? 'SAVE CHANGES' : 'CREATE TASK';
  document.getElementById('edit-task-id').value = task ? task.id : '';

  if (task) {
    document.getElementById('f-title').value      = task.title || '';
    document.getElementById('f-desc').value       = task.description || '';
    document.getElementById('f-energy').value     = task.energy_level || '';
    document.getElementById('f-recurrence').value = task.recurrence_pattern || '';
    if (task.due_date) {
      document.getElementById('f-due').value = new Date(task.due_date).toISOString().slice(0, 16);
    }
    if (task.dread_score) {
      document.getElementById('f-dread').value = task.dread_score;
      document.querySelector(`.dread-btn[data-v="${task.dread_score}"]`)?.classList.add('selected');
    }
    if (task.reminder_enabled) {
      document.getElementById('f-reminder-enabled').checked = true;
      document.getElementById('f-reminder-config').classList.remove('hidden');
      document.getElementById('f-reminder-minutes').value = task.reminder_minutes_before || 30;
      document.getElementById('f-reminder-email').value   = task.reminder_email || '';
    }
  }

  overlay.classList.remove('hidden');
  document.getElementById('f-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// ─────────────────────────────────────────────
//  Focus mode
// ─────────────────────────────────────────────
const focus = {
  task:     null,
  duration: 25 * 60,
  timeLeft: 25 * 60,
  running:  false,
  sessions: 0,
  interval: null,
};

function openFocus(taskId) {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return;

  clearInterval(focus.interval);
  focus.task     = task;
  focus.sessions = 0;
  focus.running  = false;
  resetFocusTimer(true);

  // Task info
  document.getElementById('focus-task-info').innerHTML = `
    <div class="focus-task-title">${escHtml(task.title)}</div>
    <div class="task-meta" style="margin-top:4px">
      ${energyBadge(task.energy_level)}
      ${dreadBar(task.dread_score)}
    </div>`;

  document.getElementById('focus-start').textContent = '▶ START';
  document.getElementById('focus-sessions').textContent = 'Session 1';
  document.getElementById('focus-overlay').classList.remove('hidden');
}

function closeFocus() {
  clearInterval(focus.interval);
  focus.running = false;
  document.getElementById('focus-overlay').classList.add('hidden');
}

function resetFocusTimer(useSelect = false) {
  clearInterval(focus.interval);
  focus.running = false;
  if (useSelect) {
    const mins = parseInt(document.getElementById('focus-duration-select').value) || 25;
    focus.duration = mins * 60;
  }
  focus.timeLeft = focus.duration;
  renderFocusTimer();
  document.getElementById('focus-start').textContent = '▶ START';
}

function renderFocusTimer() {
  const m = String(Math.floor(focus.timeLeft / 60)).padStart(2, '0');
  const s = String(focus.timeLeft % 60).padStart(2, '0');
  const el = document.getElementById('focus-timer');
  el.textContent = `${m}:${s}`;
  const ratio = focus.timeLeft / focus.duration;
  el.className = 'focus-timer' + (ratio < 0.2 ? ' urgent' : ratio < 0.4 ? ' warning' : '');
}

function tickFocus() {
  if (focus.timeLeft <= 0) {
    clearInterval(focus.interval);
    focus.running = false;
    focus.sessions += 1;
    document.getElementById('focus-sessions').textContent = `Session ${focus.sessions + 1}`;
    document.getElementById('focus-start').textContent = '▶ START';
    document.getElementById('focus-timer-label').textContent = '✓ SESSION DONE';
    showToast(`Session complete! 🎉 Take a break.`);
    if (Notification.permission === 'granted') {
      new Notification('TASKMGMT — Session done!', {
        body: `Finished: ${focus.task?.title}. Time for a break.`,
        icon: '',
      });
    }
    return;
  }
  focus.timeLeft--;
  renderFocusTimer();
}

// ─────────────────────────────────────────────
//  Browser notifications
// ─────────────────────────────────────────────
function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    const btn = document.getElementById('notif-btn');
    btn.classList.remove('hidden');
    btn.addEventListener('click', async () => {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        btn.classList.add('hidden');
        showToast('Notifications enabled.');
      }
    }, { once: true });
  }
}

function checkDueNotifications() {
  if (Notification.permission !== 'granted') return;
  const now   = Date.now();
  const win   = 30 * 60 * 1000; // 30 min window

  state.tasks.forEach(task => {
    if (task.completed || state.notifiedTaskIds.has(task.id)) return;
    const ref = task.is_recurring ? task.next_due_at : task.due_date;
    if (!ref) return;
    const due = new Date(ref).getTime();
    if (due > now && due - now <= win) {
      state.notifiedTaskIds.add(task.id);
      const mins = Math.round((due - now) / 60000);
      new Notification(`TASKMGMT — Due in ${mins}m`, {
        body: task.title,
        tag:  `task-${task.id}`,
      });
    }
  });
}

// ─────────────────────────────────────────────
//  Yesterday rollover check
// ─────────────────────────────────────────────
async function checkRollover() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const key = yesterday.toISOString().slice(0, 10);

  try {
    const plan = await api.getPlanByDate(key);
    if (!plan.must_do_task_ids?.length) return;

    // Tasks that were pinned yesterday but still not completed today
    const unfinished = plan.must_do_tasks.filter(t => !t.completed);
    if (unfinished.length) {
      state.rolloverTasks = unfinished;
    }
  } catch (_) {}
}

// ─────────────────────────────────────────────
//  Action handlers
// ─────────────────────────────────────────────
async function handleComplete(id) {
  const updated = await api.completeTask(id);
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx !== -1) state.tasks[idx] = updated;
  render();
}

async function handleDelete(id) {
  await api.deleteTask(id);
  state.tasks = state.tasks.filter(t => t.id !== id);
  const ids = (state.todayPlan.must_do_task_ids || []).filter(i => i !== id);
  if (ids.length !== (state.todayPlan.must_do_task_ids || []).length) {
    state.todayPlan = await api.setMustDos(ids);
  }
  if (state.expandedTaskId === id) state.expandedTaskId = null;
  render();
}

async function handlePin(id) {
  const current = state.todayPlan.must_do_task_ids || [];
  let next;
  if (current.includes(id)) {
    next = current.filter(i => i !== id);
  } else {
    if (current.length >= 3) { showToast('Already have 3 must-dos. Remove one first.'); return; }
    next = [...current, id];
  }
  state.todayPlan = await api.setMustDos(next);
  render();
}

async function handleSaveDesc(id) {
  const textarea = document.getElementById(`expand-desc-${id}`);
  if (!textarea) return;
  const updated = await api.updateTask(id, { description: textarea.value });
  const idx = state.tasks.findIndex(t => t.id === id);
  if (idx !== -1) state.tasks[idx] = updated;
  showToast('Notes saved.');
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const editId     = document.getElementById('edit-task-id').value;
  const recurrence = document.getElementById('f-recurrence').value;
  const dueVal     = document.getElementById('f-due').value;
  const dreadVal   = document.getElementById('f-dread').value;

  const data = {
    title:               document.getElementById('f-title').value.trim(),
    description:         document.getElementById('f-desc').value.trim() || null,
    energy_level:        document.getElementById('f-energy').value || null,
    dread_score:         dreadVal ? parseInt(dreadVal) : null,
    due_date:            dueVal ? new Date(dueVal).toISOString() : null,
    is_recurring:        !!recurrence,
    recurrence_pattern:  recurrence || null,
    reminder_enabled:    document.getElementById('f-reminder-enabled').checked,
    reminder_minutes_before: parseInt(document.getElementById('f-reminder-minutes').value) || 30,
    reminder_email:      document.getElementById('f-reminder-email').value.trim() || null,
  };

  try {
    if (editId) {
      const updated = await api.updateTask(parseInt(editId), data);
      const idx = state.tasks.findIndex(t => t.id === updated.id);
      if (idx !== -1) state.tasks[idx] = updated; else state.tasks.unshift(updated);
    } else {
      const created = await api.createTask(data);
      state.tasks.unshift(created);
    }
    closeModal();
    render();
  } catch (err) {
    console.error(err);
    showToast('Error saving task.');
  }
}

// ─────────────────────────────────────────────
//  Toast
// ─────────────────────────────────────────────
function showToast(msg) {
  const el = document.createElement('div');
  el.textContent = msg;
  Object.assign(el.style, {
    position: 'fixed', bottom: '24px', right: '24px',
    background: 'var(--bg1)', border: '1px solid var(--border2)',
    color: 'var(--text)', fontFamily: 'inherit', fontSize: '12px',
    padding: '10px 16px', borderRadius: '3px', zIndex: '9999',
    letterSpacing: '0.5px', boxShadow: '0 4px 12px var(--shadow)',
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ─────────────────────────────────────────────
//  Theme
// ─────────────────────────────────────────────
function initTheme() {
  const saved     = localStorage.getItem('taskmgmt-theme');
  const preferred = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  applyTheme(saved || preferred);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('taskmgmt-theme', theme);
  document.getElementById('theme-toggle').textContent = theme === 'light' ? '◑' : '◐';
}

// ─────────────────────────────────────────────
//  Event wiring
// ─────────────────────────────────────────────
function wire() {
  // Tabs
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;
      state.expandedTaskId = null;
      render();
    });
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'light' ? 'dark' : 'light');
  });

  // Dread picker
  document.getElementById('dread-picker').addEventListener('click', e => {
    const btn = e.target.closest('.dread-btn');
    if (!btn) return;
    const v = btn.dataset.v;
    const current = document.getElementById('f-dread').value;
    if (current === v) {
      document.getElementById('f-dread').value = '';
      document.querySelectorAll('.dread-btn').forEach(b => b.classList.remove('selected'));
    } else {
      document.getElementById('f-dread').value = v;
      document.querySelectorAll('.dread-btn').forEach(b =>
        b.classList.toggle('selected', b.dataset.v === v)
      );
    }
  });

  // Reminder toggle visibility
  document.getElementById('f-reminder-enabled').addEventListener('change', e => {
    document.getElementById('f-reminder-config').classList.toggle('hidden', !e.target.checked);
  });

  // Modal close
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Form submit
  document.getElementById('task-form').addEventListener('submit', handleFormSubmit);

  // Focus mode controls
  document.getElementById('focus-exit').addEventListener('click', closeFocus);
  document.getElementById('focus-start').addEventListener('click', () => {
    if (focus.running) {
      clearInterval(focus.interval);
      focus.running = false;
      document.getElementById('focus-start').textContent = '▶ RESUME';
    } else {
      focus.running = true;
      document.getElementById('focus-timer-label').textContent = 'WORK SESSION';
      document.getElementById('focus-start').textContent = '⏸ PAUSE';
      focus.interval = setInterval(tickFocus, 1000);
    }
  });
  document.getElementById('focus-reset').addEventListener('click', () => resetFocusTimer(false));
  document.getElementById('focus-duration-select').addEventListener('change', () => resetFocusTimer(true));
  document.getElementById('focus-complete').addEventListener('click', async () => {
    if (!focus.task) return;
    try {
      await handleComplete(focus.task.id);
      closeFocus();
      showToast('Task marked complete!');
    } catch (e) { showToast('Error completing task.'); }
  });
  document.getElementById('focus-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('focus-overlay')) closeFocus();
  });

  // ── Delegated events on document ──
  document.addEventListener('click', async e => {
    const t = e.target;

    if (t.id === 'add-task-btn' || t.id === 'hint-add-link') { openModal(); return; }

    // Filter / energy
    if (t.classList.contains('filter-btn')) {
      state.completionFilter = t.dataset.filter; render(); return;
    }
    if (t.classList.contains('energy-chip')) {
      state.energyFilter = state.energyFilter === t.dataset.energy ? '' : t.dataset.energy;
      render(); return;
    }

    // Rollover
    if (t.id === 'rollover-carry') {
      const freeSlots = 3 - (state.todayPlan.must_do_task_ids || []).length;
      const toAdd     = state.rolloverTasks.slice(0, freeSlots).map(t => t.id);
      const newIds    = [...new Set([...(state.todayPlan.must_do_task_ids || []), ...toAdd])];
      try {
        state.todayPlan = await api.setMustDos(newIds.slice(0, 3));
      } catch (_) {}
      state.rolloverDismissed = true;
      render(); return;
    }
    if (t.id === 'rollover-dismiss') {
      state.rolloverDismissed = true; render(); return;
    }

    // Task actions
    const action = t.dataset.action;
    const id     = parseInt(t.dataset.id);
    if (!action || isNaN(id)) return;

    try {
      if (action === 'expand') {
        state.expandedTaskId = state.expandedTaskId === id ? null : id;
        render();
      }
      if (action === 'delete') {
        if (confirm('Delete this task?')) await handleDelete(id);
      }
      if (action === 'edit') {
        const task = state.tasks.find(t => t.id === id);
        if (task) openModal(task);
      }
      if (action === 'pin' || action === 'unpin') await handlePin(id);
      if (action === 'save-desc') await handleSaveDesc(id);
      if (action === 'focus') openFocus(id);
    } catch (err) {
      console.error(err);
      showToast('Something went wrong.');
    }
  });

  // Checkboxes
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.classList.contains('task-checkbox') && t.dataset.action === 'complete') {
      try { await handleComplete(parseInt(t.dataset.id)); }
      catch (err) { console.error(err); render(); } // revert visual on error
    }
  });

  // ── Drag & drop for must-do slots ──
  document.addEventListener('dragstart', e => {
    const slot = e.target.closest('[data-mustdo-index]');
    if (!slot || !slot.classList.contains('filled')) return;
    drag.srcIndex = parseInt(slot.dataset.mustdoIndex);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => slot.style.opacity = '0.4', 0);
  });

  document.addEventListener('dragend', e => {
    const slot = e.target.closest('[data-mustdo-index]');
    if (slot) slot.style.opacity = '';
    drag.srcIndex = null;
    document.querySelectorAll('.mustdo-slot').forEach(s => s.classList.remove('drag-over'));
  });

  document.addEventListener('dragover', e => {
    const slot = e.target.closest('[data-mustdo-index]');
    if (!slot) return;
    e.preventDefault();
    document.querySelectorAll('.mustdo-slot').forEach(s => s.classList.remove('drag-over'));
    slot.classList.add('drag-over');
  });

  document.addEventListener('drop', async e => {
    e.preventDefault();
    const slot = e.target.closest('[data-mustdo-index]');
    document.querySelectorAll('.mustdo-slot').forEach(s => s.classList.remove('drag-over'));
    if (!slot || drag.srcIndex === null) return;

    const targetIndex = parseInt(slot.dataset.mustdoIndex);
    if (drag.srcIndex === targetIndex) return;

    const ids    = [...(state.todayPlan.must_do_task_ids || [])];
    // Pad to 3 for reordering
    while (ids.length < 3) ids.push(null);
    const [moved] = ids.splice(drag.srcIndex, 1, null);
    ids[targetIndex] = moved;
    const cleaned = ids.filter(Boolean);

    try {
      state.todayPlan = await api.setMustDos(cleaned);
      render();
    } catch (_) {}
  });

  // Keyboard
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('focus-overlay').classList.contains('hidden')) { closeFocus(); return; }
      closeModal();
    }
    if (e.key === 'n' && !e.target.matches('input, textarea, select')) { openModal(); }
  });
}

// ─────────────────────────────────────────────
//  Init
// ─────────────────────────────────────────────
async function init() {
  initTheme();

  document.getElementById('header-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'short', year: 'numeric', month: 'short', day: 'numeric',
  }).toUpperCase();

  wire();

  try {
    [state.tasks, state.todayPlan] = await Promise.all([api.getTasks(), api.getTodayPlan()]);
  } catch (_) {
    document.getElementById('main').innerHTML = `
      <div class="empty-state" style="color:var(--red)">
        ⚠ Cannot reach backend at ${API_BASE}.<br>
        <span style="font-size:11px">Run: cd backend &amp;&amp; uvicorn main:app --reload</span>
      </div>`;
    document.getElementById('toolbar').innerHTML = '';
    return;
  }

  render();

  await checkRollover();
  if (state.rolloverTasks.length && state.activeTab === 'today') render();

  // Request notification permission after a short delay (less intrusive)
  setTimeout(requestNotificationPermission, 3000);

  // Refresh heat bars + check due notifications every minute
  setInterval(async () => {
    try { state.tasks = await api.getTasks(); } catch (_) {}
    if (state.activeTab === 'streaks' || state.activeTab === 'today') render();
    checkDueNotifications();
  }, 60000);
}

document.addEventListener('DOMContentLoaded', init);
