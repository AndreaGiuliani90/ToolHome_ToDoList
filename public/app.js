// Casa Tasks — frontend
const $ = (id) => document.getElementById(id);

let config = { googleClientId: null, devLogin: false, aiEnabled: false };
let me = null;
let tasks = [];
const filters = { status: 'open', store: null, room: null, category: null, q: '' };

const PRIORITY_ORDER = { alta: 0, media: 1, bassa: 2 };
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Il campo store può contenere più negozi separati da virgola ("IKEA, Leroy Merlin")
const storesOf = (t) => (t.store || '').split(',').map((s) => s.trim()).filter(Boolean);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Errore ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- Routing tra le viste ----------

const VIEWS = ['view-loading', 'view-login', 'view-pending', 'view-app', 'view-admin'];
function show(viewId) {
  for (const id of VIEWS) $(id).hidden = id !== viewId;
}

async function route() {
  if (!me) return showLogin();
  if (!me.approved) return show('view-pending');
  show('view-app');
  $('adminBtn').hidden = !me.isAdmin;
  await loadTasks();
}

// ---------- Login ----------

function showLogin() {
  show('view-login');
  $('devLoginBtn').hidden = !config.devLogin;
  if (config.googleClientId) mountGoogleButton();
}

function mountGoogleButton() {
  const tryMount = () => {
    if (!window.google?.accounts?.id) return false;
    window.google.accounts.id.initialize({
      client_id: config.googleClientId,
      callback: onGoogleCredential,
    });
    window.google.accounts.id.renderButton($('googleButton'), {
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
    });
    return true;
  };
  if (tryMount()) return;
  const timer = setInterval(() => {
    if (tryMount()) clearInterval(timer);
  }, 200);
  setTimeout(() => clearInterval(timer), 15000);
}

async function onGoogleCredential(response) {
  try {
    me = await api('/api/auth/google', { method: 'POST', body: { credential: response.credential } });
    route();
  } catch (err) {
    $('loginError').textContent = err.message;
    $('loginError').hidden = false;
  }
}

$('devLoginBtn').addEventListener('click', async () => {
  me = await api('/api/auth/dev', { method: 'POST' });
  route();
});

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  me = null;
  route();
}
$('logoutBtn').addEventListener('click', logout);
$('pendingLogoutBtn').addEventListener('click', logout);

// ---------- Attività ----------

async function loadTasks() {
  tasks = await api('/api/tasks');
  render();
}

function taskMatches(t, skipDimension = null) {
  if (filters.status !== 'all' && t.status !== filters.status) return false;
  if (filters.q) {
    const hay = `${t.title} ${t.original_text || ''} ${t.notes || ''} ${t.store || ''} ${t.room || ''} ${t.category || ''}`.toLowerCase();
    if (!hay.includes(filters.q.toLowerCase())) return false;
  }
  for (const dim of ['store', 'room', 'category']) {
    if (dim === skipDimension || !filters[dim]) continue;
    if (dim === 'store') {
      if (!storesOf(t).includes(filters.store)) return false;
    } else if (t[dim] !== filters[dim]) {
      return false;
    }
  }
  return true;
}

function facetCounts(dimension) {
  const counts = new Map();
  for (const t of tasks) {
    if (t.pending) continue;
    if (!taskMatches(t, dimension)) continue;
    const values = dimension === 'store' ? storesOf(t) : t[dimension] ? [t[dimension]] : [];
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function chip(label, active, onClick, count = null) {
  const btn = document.createElement('button');
  btn.className = 'chip' + (active ? ' active' : '');
  btn.innerHTML = esc(label) + (count !== null ? ` <span class="count">${count}</span>` : '');
  btn.addEventListener('click', onClick);
  return btn;
}

function renderChipRow(el, dimension, icon) {
  el.replaceChildren();
  const entries = facetCounts(dimension);
  if (!entries.length && !filters[dimension]) return;
  for (const [value, count] of entries) {
    el.appendChild(
      chip(`${icon} ${value}`, filters[dimension] === value, () => {
        filters[dimension] = filters[dimension] === value ? null : value;
        render();
      }, count)
    );
  }
  // Valore filtrato che non compare più tra i risultati: mostralo comunque per poterlo togliere
  if (filters[dimension] && !entries.some(([v]) => v === filters[dimension])) {
    el.appendChild(chip(`${icon} ${filters[dimension]} ✕`, true, () => {
      filters[dimension] = null;
      render();
    }));
  }
}

function render() {
  // Chips di stato
  const statusEl = $('statusChips');
  statusEl.replaceChildren();
  for (const [value, label] of [['open', 'Da fare'], ['done', 'Fatte'], ['all', 'Tutte']]) {
    statusEl.appendChild(chip(label, filters.status === value, () => {
      filters.status = value;
      render();
    }));
  }
  const hasFilters = filters.store || filters.room || filters.category || filters.q;
  if (hasFilters) {
    statusEl.appendChild(chip('✕ Azzera filtri', false, () => {
      filters.store = filters.room = filters.category = null;
      filters.q = '';
      $('searchInput').value = '';
      render();
    }));
  }

  renderChipRow($('storeChips'), 'store', '🛒');
  renderChipRow($('roomChips'), 'room', '🚪');
  renderChipRow($('categoryChips'), 'category', '🔧');

  // Lista
  const visible = tasks
    .filter((t) => t.pending || taskMatches(t))
    .sort((a, b) => {
      if (a.pending !== b.pending) return a.pending ? -1 : 1;
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      const p = (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1);
      if (p !== 0) return p;
      return b.created_at.localeCompare(a.created_at);
    });

  const list = $('taskList');
  list.replaceChildren(...visible.map(taskElement));
  $('emptyState').hidden = visible.length > 0;

  const summary = $('filterSummary');
  summary.hidden = !hasFilters;
  if (hasFilters) summary.textContent = `${visible.length} attività corrispondenti ai filtri`;
}

function tagButton(cls, dimension, value, label) {
  const btn = document.createElement('button');
  btn.className = `tag ${cls} ${esc(value)}`;
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!dimension) return;
    filters[dimension] = filters[dimension] === value ? null : value;
    render();
  });
  return btn;
}

function taskElement(t) {
  const li = document.createElement('li');
  li.className = 'task' + (t.status === 'done' ? ' done' : '') + (t.pending ? ' pending-ai' : '');

  const check = document.createElement('button');
  check.className = 'task-check' + (t.status === 'done' ? ' checked' : '');
  check.title = t.status === 'done' ? 'Segna da fare' : 'Segna come fatta';
  check.textContent = t.status === 'done' ? '✓' : '';
  check.disabled = Boolean(t.pending);
  check.addEventListener('click', () => toggleDone(t));

  const body = document.createElement('div');
  body.className = 'task-body';
  body.tabIndex = 0;

  const title = document.createElement('div');
  title.className = 'task-title';
  title.textContent = t.title;
  body.appendChild(title);

  const tags = document.createElement('div');
  tags.className = 'task-tags';
  if (t.pending) {
    const wait = document.createElement('span');
    wait.className = 'tag tag-category';
    wait.textContent = '✨ classifico…';
    tags.appendChild(wait);
  } else {
    for (const s of storesOf(t)) tags.appendChild(tagButton('tag-store', 'store', s, `🛒 ${s}`));
    if (t.room) tags.appendChild(tagButton('tag-room', 'room', t.room, `🚪 ${t.room}`));
    if (t.category) tags.appendChild(tagButton('tag-category', 'category', t.category, t.category));
    if (t.priority && t.priority !== 'media') {
      tags.appendChild(tagButton('tag-priority', null, t.priority, t.priority === 'alta' ? '⚡ Alta' : 'Bassa'));
    }
  }
  if (tags.children.length) body.appendChild(tags);

  if (t.notes) {
    const notes = document.createElement('div');
    notes.className = 'task-notes';
    notes.textContent = t.notes;
    body.appendChild(notes);
  }

  const meta = document.createElement('div');
  meta.className = 'task-meta';
  const date = t.created_at ? new Date(t.created_at).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' }) : '';
  meta.textContent = `${date}${t.ai_source === 'ai' ? ' · ✨ AI' : ''}`;
  body.appendChild(meta);

  if (!t.pending) {
    body.addEventListener('click', () => openEdit(t));
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') openEdit(t);
    });
  }

  li.append(check, body);
  return li;
}

async function toggleDone(t) {
  const status = t.status === 'done' ? 'open' : 'done';
  Object.assign(t, { status });
  render();
  try {
    const updated = await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status } });
    Object.assign(t, updated);
  } catch {
    Object.assign(t, { status: status === 'done' ? 'open' : 'done' });
  }
  render();
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $('addInput');
  const text = input.value.trim();
  if (!text) return;
  input.value = '';

  const temp = { id: `tmp-${Date.now()}`, title: text, status: 'open', pending: true, created_at: new Date().toISOString() };
  tasks.unshift(temp);
  render();
  input.focus();

  try {
    const created = await api('/api/tasks', { method: 'POST', body: { text } });
    tasks.splice(tasks.indexOf(temp), 1, created);
  } catch (err) {
    tasks.splice(tasks.indexOf(temp), 1);
    alert(`Errore: ${err.message}`);
  }
  render();
});

$('addInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('addForm').requestSubmit();
  }
});

$('searchInput').addEventListener('input', (e) => {
  filters.q = e.target.value.trim();
  render();
});

// ---------- Modifica ----------

let editingTask = null;
const dialog = $('editDialog');
const editForm = $('editForm');

function fillDatalist(id, values, defaults) {
  const el = $(id);
  el.replaceChildren();
  for (const v of new Set([...values, ...defaults])) {
    const opt = document.createElement('option');
    opt.value = v;
    el.appendChild(opt);
  }
}

function openEdit(t) {
  editingTask = t;
  editForm.title.value = t.title || '';
  editForm.store.value = t.store || '';
  editForm.room.value = t.room || '';
  editForm.category.value = t.category || '';
  editForm.priority.value = t.priority || 'media';
  editForm.notes.value = t.notes || '';
  fillDatalist('storeOptions', tasks.flatMap(storesOf), ['IKEA', 'Leroy Merlin', 'Brico', 'OBI', 'Amazon', 'Supermercato', 'Ferramenta']);
  fillDatalist('roomOptions', tasks.map((x) => x.room).filter(Boolean), ['Cucina', 'Bagno', 'Camera', 'Soggiorno', 'Corridoio', 'Balcone', 'Garage', 'Studio', 'Tutta casa']);
  fillDatalist('categoryOptions', tasks.map((x) => x.category).filter(Boolean), ['Acquisto', 'Montaggio', 'Riparazione', 'Pulizia', 'Elettricità', 'Idraulica', 'Decorazione', 'Burocrazia', 'Trasloco', 'Altro']);
  dialog.showModal();
}

editForm.addEventListener('submit', async () => {
  if (!editingTask) return;
  const body = {
    title: editForm.title.value.trim(),
    store: editForm.store.value.trim(),
    room: editForm.room.value.trim(),
    category: editForm.category.value.trim(),
    priority: editForm.priority.value,
    notes: editForm.notes.value.trim(),
  };
  try {
    const updated = await api(`/api/tasks/${editingTask.id}`, { method: 'PATCH', body });
    Object.assign(editingTask, updated, { store: updated.store, room: updated.room, category: updated.category, notes: updated.notes });
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
  editingTask = null;
  render();
});

$('cancelEditBtn').addEventListener('click', () => dialog.close());

$('reclassifyBtn').addEventListener('click', async () => {
  if (!editingTask) return;
  const btn = $('reclassifyBtn');
  btn.disabled = true;
  btn.textContent = '✨ Analizzo…';
  try {
    const updated = await api(`/api/tasks/${editingTask.id}/reclassify`, { method: 'POST' });
    Object.assign(editingTask, updated);
    dialog.close();
    editingTask = null;
    render();
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
  btn.disabled = false;
  btn.textContent = '✨ Riclassifica';
});

$('deleteTaskBtn').addEventListener('click', async () => {
  if (!editingTask) return;
  if (!confirm('Eliminare questa attività?')) return;
  try {
    await api(`/api/tasks/${editingTask.id}`, { method: 'DELETE' });
    tasks = tasks.filter((t) => t.id !== editingTask.id);
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
  editingTask = null;
  dialog.close();
  render();
});

// ---------- Admin ----------

$('adminBtn').addEventListener('click', showAdmin);
$('adminBackBtn').addEventListener('click', () => {
  show('view-app');
  loadTasks();
});

async function showAdmin() {
  show('view-admin');
  const users = await api('/api/users');
  const list = $('userList');
  list.replaceChildren(
    ...users.map((u) => {
      const li = document.createElement('li');
      li.className = 'task user-row';

      const avatar = document.createElement('img');
      avatar.className = 'user-avatar';
      avatar.src = u.picture || 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="70" x="15">👤</text></svg>');
      avatar.alt = '';

      const info = document.createElement('div');
      info.className = 'user-info';
      info.innerHTML = `<div>${esc(u.name || 'Senza nome')} ${u.isAdmin ? '<span class="badge">admin</span>' : ''} ${u.approved ? '<span class="badge ok">approvato</span>' : '<span class="badge">in attesa</span>'}</div><div class="email">${esc(u.email)}</div>`;

      const btn = document.createElement('button');
      btn.className = 'btn' + (u.approved ? '' : ' btn-primary');
      btn.textContent = u.approved ? 'Revoca' : 'Approva';
      btn.disabled = u.id === me.id;
      btn.addEventListener('click', async () => {
        try {
          await api(`/api/users/${u.id}/approve`, { method: 'POST', body: { approved: !u.approved } });
          showAdmin();
        } catch (err) {
          alert(`Errore: ${err.message}`);
        }
      });

      li.append(avatar, info, btn);
      return li;
    })
  );
}

// ---------- Modalità TV ----------

const TV_AUTO = /silk|aft\w|smart-?tv|crkey|tizen|webos/i.test(navigator.userAgent);
function setTv(on) {
  document.body.classList.toggle('tv', on);
  try { localStorage.setItem('tvMode', on ? '1' : '0'); } catch {}
}
try {
  const stored = localStorage.getItem('tvMode');
  setTv(stored === null ? TV_AUTO : stored === '1');
} catch {
  setTv(TV_AUTO);
}
$('tvToggleBtn').addEventListener('click', () => setTv(!document.body.classList.contains('tv')));

// Navigazione spaziale con le frecce (telecomando Firestick / tastiera) in modalità TV
document.addEventListener('keydown', (e) => {
  if (!document.body.classList.contains('tv')) return;
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const active = document.activeElement;
  if (active && ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName) && ['ArrowLeft', 'ArrowRight'].includes(e.key)) return;

  const focusables = [...document.querySelectorAll('button, input, select, textarea, [tabindex="0"]')]
    .filter((el) => el.offsetParent !== null && !el.disabled);
  if (!focusables.length) return;
  if (!active || !focusables.includes(active)) {
    focusables[0].focus();
    e.preventDefault();
    return;
  }

  const rect = active.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  let best = null;
  let bestScore = Infinity;
  for (const el of focusables) {
    if (el === active) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    const dx = ex - cx;
    const dy = ey - cy;
    const inDirection =
      (e.key === 'ArrowUp' && dy < -4) ||
      (e.key === 'ArrowDown' && dy > 4) ||
      (e.key === 'ArrowLeft' && dx < -4) ||
      (e.key === 'ArrowRight' && dx > 4);
    if (!inDirection) continue;
    const main = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? Math.abs(dy) : Math.abs(dx);
    const cross = e.key === 'ArrowUp' || e.key === 'ArrowDown' ? Math.abs(dx) : Math.abs(dy);
    const score = main + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus();
    best.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    e.preventDefault();
  }
});

// ---------- Avvio ----------

(async function start() {
  try {
    config = await api('/api/config');
  } catch {
    // config non raggiungibile: resta la vista di caricamento
  }
  try {
    me = await api('/api/me');
  } catch {
    me = null;
  }
  route();
})();
