// Casa Tasks — frontend (design "Casa Todo")
const $ = (id) => document.getElementById(id);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let config = { mode: 'simple', googleClientId: null, users: [], aiEnabled: false };
let me = null;
let tasks = [];

const ui = {
  tab: 'lista',            // mobile: lista | negozi | stanze | fatte
  q: '',
  homeFilter: 'Tutte',     // mobile lista: Tutte | Urgenti | <negozio>
  shopStore: null,         // modalità spesa
  cart: new Set(),
  view: 'Tutte',           // desktop: Tutte | Con scadenza | Assegnate a me | Fatte
  store: null, room: null, type: null, // facet desktop
  selectedId: null,
  toast: null,             // {msg, ids}
  tv: false,
};

const celebrating = new Set();
let toastTimer = null;
let tvPoll = null;
const isDesktop = window.matchMedia('(min-width: 980px)');
isDesktop.addEventListener('change', () => renderAll());

const OWNER_GRADIENTS = [
  'linear-gradient(135deg,#1aa88c,#0f6a58)',
  'linear-gradient(135deg,#a24bf0,#e0479f)',
  'linear-gradient(135deg,#ff9a5a,#e0702c)',
  'linear-gradient(135deg,#4b8cf0,#4741e0)',
];

// ---------- Utility ----------

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

const splitList = (s) => (s || '').split(',').map((x) => x.trim()).filter(Boolean);
const storesOf = (t) => splitList(t.store);
const ownersOf = (t) => splitList(t.owners);

function ownerGradient(name) {
  const known = (config.users || []).findIndex((u) => u.toLowerCase() === name.toLowerCase());
  if (known >= 0) return OWNER_GRADIENTS[known % OWNER_GRADIENTS.length];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 997;
  return OWNER_GRADIENTS[h % OWNER_GRADIENTS.length];
}

function fmtDue(d) {
  if (!d) return null;
  const date = new Date(`${d}T12:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const diff = Math.round((date - today) / 86400000);
  let label;
  if (diff < 0) label = 'Scaduta';
  else if (diff === 0) label = 'Oggi';
  else if (diff === 1) label = 'Domani';
  else {
    label = date.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric' }).replace(/^./, (c) => c.toUpperCase());
  }
  return { label, hot: diff <= 1, diff };
}

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(paths, opts = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', opts.size || 14);
  svg.setAttribute('height', opts.size || 14);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', opts.stroke || '#fff');
  svg.setAttribute('stroke-width', opts.width || 3.2);
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}

// ---------- Autenticazione ----------

const VIEWS = ['view-loading', 'view-login', 'view-pending', 'view-app', 'view-tv', 'view-admin'];
function show(viewId) {
  for (const id of VIEWS) $(id).hidden = id !== viewId;
}

async function route() {
  if (!me) return showLogin();
  if (!me.approved) return show('view-pending');
  $$('.adminBtn').forEach((b) => (b.hidden = !me.isAdmin));
  await loadTasks();
  if (ui.tv) enterTv();
  else {
    show('view-app');
    renderAll();
  }
}

function showLogin() {
  show('view-login');
  if (config.mode === 'google') mountGoogleButton();
  else renderSimpleUsers();
}

function renderSimpleUsers() {
  $('loginSubtitle').textContent = 'Chi sei?';
  $('simpleUsers').replaceChildren(
    ...(config.users || []).map((name) => {
      const btn = el('button', 'simple-user', name);
      btn.addEventListener('click', async () => {
        try {
          me = await api('/api/auth/simple', { method: 'POST', body: { name } });
          route();
        } catch (err) {
          $('loginError').textContent = err.message;
          $('loginError').hidden = false;
        }
      });
      return btn;
    })
  );
}

function mountGoogleButton() {
  const tryMount = () => {
    if (!window.google?.accounts?.id) return false;
    window.google.accounts.id.initialize({ client_id: config.googleClientId, callback: onGoogleCredential });
    window.google.accounts.id.renderButton($('googleButton'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill' });
    return true;
  };
  if (tryMount()) return;
  const timer = setInterval(() => tryMount() && clearInterval(timer), 200);
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

async function logout() {
  await api('/api/auth/logout', { method: 'POST' });
  me = null;
  route();
}
$$('.logoutBtn').forEach((b) => b.addEventListener('click', logout));
$('pendingLogoutBtn').addEventListener('click', logout);

// ---------- Dati e azioni ----------

async function loadTasks() {
  tasks = await api('/api/tasks');
  if (!ui.selectedId && tasks.length) ui.selectedId = tasks[0].id;
}

function celebrate(ids) {
  ids.forEach((id) => celebrating.add(id));
  setTimeout(() => {
    ids.forEach((id) => celebrating.delete(id));
    renderAll();
  }, 1150);
}

function showToast(msg, ids) {
  ui.toast = { msg, ids };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = null;
    renderAll();
  }, 4200);
}

async function toggleDone(t) {
  if (t.pending) return;
  const toDone = t.status !== 'done';
  t.status = toDone ? 'done' : 'open';
  if (toDone) {
    celebrate([t.id]);
    showToast(`${t.title} — fatta!`, [t.id]);
  } else if (ui.toast?.ids?.includes(t.id)) {
    ui.toast = null;
  }
  renderAll();
  try {
    const updated = await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { status: t.status } });
    Object.assign(t, updated);
  } catch {
    t.status = toDone ? 'open' : 'done';
  }
  renderAll();
}

async function undoToast() {
  const ids = ui.toast?.ids || [];
  ui.toast = null;
  for (const id of ids) {
    const t = tasks.find((x) => x.id === id);
    if (t) t.status = 'open';
  }
  renderAll();
  await Promise.allSettled(ids.map((id) => api(`/api/tasks/${id}`, { method: 'PATCH', body: { status: 'open' } })));
}

async function bulkDone(ids, msg) {
  const list = ids.map((id) => tasks.find((t) => t.id === id)).filter(Boolean);
  list.forEach((t) => (t.status = 'done'));
  celebrate(ids);
  showToast(msg, ids);
  ui.cart = new Set();
  renderAll();
  await Promise.allSettled(ids.map((id) => api(`/api/tasks/${id}`, { method: 'PATCH', body: { status: 'done' } })));
}

async function setParked(t, val) {
  t.parked = val ? 1 : 0;
  renderAll();
  try {
    const updated = await api(`/api/tasks/${t.id}`, { method: 'PATCH', body: { parked: t.parked } });
    Object.assign(t, updated);
  } catch {
    t.parked = val ? 0 : 1;
  }
  renderAll();
}

// ---------- Costruzione card ----------

function checkboxEl(t) {
  const wrap = el('div', 'ckwrap');
  if (celebrating.has(t.id)) wrap.appendChild(el('span', 'ring-burst'));
  const ck = el('span', 'ck' + (t.status === 'done' ? ' on' : ''));
  if (t.status === 'done') ck.appendChild(svgIcon(['m5 13 4 4 10-10']));
  wrap.appendChild(ck);
  wrap.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDone(t);
  });
  return wrap;
}

function ownersEl(t, small) {
  const box = el('div', 'task-owners');
  for (const name of ownersOf(t)) {
    const a = el('div', 'avatar' + (small ? ' sm' : ''), name.charAt(0).toUpperCase());
    a.style.background = ownerGradient(name);
    a.title = name;
    box.appendChild(a);
  }
  return box;
}

function tagEls(t) {
  const out = [];
  const due = fmtDue(t.due_date);
  if (due) out.push(el('span', 'tag due' + (due.hot ? ' hot' : ''), due.label));
  else if (t.priority === 'alta') out.push(el('span', 'tag due hot', 'Urgente'));
  for (const s of storesOf(t)) {
    const tag = el('button', 'tag store', s);
    tag.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isDesktop.matches) ui.store = ui.store === s ? null : s;
      else {
        ui.tab = 'negozi';
        ui.shopStore = s;
      }
      renderAll();
    });
    out.push(tag);
  }
  if (t.room) out.push(el('span', 'tag', t.room));
  if (t.category && !storesOf(t).length) out.push(el('span', 'tag', t.category));
  if (t.cost) out.push(el('span', 'tag cost', `~${Math.round(t.cost)} €`));
  if (t.num) out.push(el('span', 'tag num', `#${t.num}`));
  return out;
}

function addCelebration(card) {
  card.appendChild(el('span', 'sheen'));
  for (let i = 1; i <= 6; i++) card.appendChild(el('span', `confetti p${i}`));
}

function taskCard(t) {
  const doneLook = t.status === 'done' && !celebrating.has(t.id);
  const card = el('div', 'task' + (doneLook ? ' done' : ''));
  if (t.parked) card.classList.add('landin');
  if (!doneLook && t.due_date) {
    card.classList.add('hasdue');
    if (fmtDue(t.due_date)?.hot) card.classList.add('hot');
  }
  if (isDesktop.matches && ui.selectedId === t.id) card.classList.add('selected');
  if (celebrating.has(t.id)) addCelebration(card);

  card.appendChild(checkboxEl(t));

  const body = el('div', 'task-body');
  body.appendChild(el('div', 'task-title', t.title));
  if (t.pending) {
    const tag = el('span', 'tag store', '✨ classifico…');
    const tags = el('div', 'task-tags');
    tags.appendChild(tag);
    body.appendChild(tags);
  } else if (!doneLook) {
    if (t.notes) body.appendChild(el('div', 'task-note', t.notes));
    const tags = el('div', 'task-tags');
    tagEls(t).forEach((x) => tags.appendChild(x));
    if (tags.children.length) body.appendChild(tags);
  }
  card.appendChild(body);
  card.appendChild(ownersEl(t, doneLook));

  if (!t.pending) {
    body.addEventListener('click', () => {
      if (isDesktop.matches) {
        ui.selectedId = t.id;
        renderAll();
      }
    });
    attachLongPress(card, () => openEdit(t));
  }
  return card;
}

function groupEl(label, items, opts = {}) {
  const g = el('div', 'group');
  const head = el('div', 'group-head');
  if (opts.red) head.appendChild(el('span', 'group-dot'));
  head.appendChild(el('span', 'group-label' + (opts.red ? ' red' : ''), label));
  if (opts.hint && isDesktop.matches) head.appendChild(el('span', 'group-hint', opts.hint));
  g.appendChild(head);
  const box = el('div', 'group-items');
  items.forEach((t) => box.appendChild(taskCard(t)));
  g.appendChild(box);
  return g;
}

// ---------- Filtri e selezioni ----------

function matchesSearch(t) {
  if (!ui.q) return true;
  const hay = `#${t.num || ''} ${t.title} ${t.original_text || ''} ${t.notes || ''} ${t.store || ''} ${t.room || ''} ${t.category || ''} ${t.owners || ''}`.toLowerCase();
  return hay.includes(ui.q.toLowerCase());
}

// Pressione prolungata (dito o mouse) → callback; il click successivo viene assorbito
function attachLongPress(target, fn) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;
  target.addEventListener('pointerdown', (e) => {
    if (e.button) return;
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      fired = true;
      navigator.vibrate?.(15);
      fn();
    }, 500);
  });
  const cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  target.addEventListener('pointermove', (e) => {
    if (timer !== null && Math.hypot(e.clientX - startX, e.clientY - startY) > 10) cancel();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) target.addEventListener(ev, cancel);
  target.addEventListener(
    'click',
    (e) => {
      if (fired) {
        e.stopPropagation();
        e.preventDefault();
        fired = false;
      }
    },
    true
  );
  target.addEventListener('contextmenu', (e) => e.preventDefault());
}

function byDue(a, b) {
  return (a.due_date || '9999').localeCompare(b.due_date || '9999') || (b.created_at || '').localeCompare(a.created_at || '');
}
const byCreated = (a, b) => (b.created_at || '').localeCompare(a.created_at || '');

function currentPool() {
  let pool = tasks.filter(matchesSearch);
  if (isDesktop.matches) {
    if (ui.view === 'Con scadenza') pool = pool.filter((t) => t.due_date);
    if (ui.view === 'Assegnate a me') pool = pool.filter((t) => ownersOf(t).some((o) => o.toLowerCase() === (me.name || '').toLowerCase()));
    if (ui.view === 'Fatte') pool = pool.filter((t) => t.status === 'done');
    if (ui.store) pool = pool.filter((t) => storesOf(t).includes(ui.store));
    if (ui.room) pool = pool.filter((t) => t.room === ui.room);
    if (ui.type) pool = pool.filter((t) => t.category === ui.type);
  } else if (ui.tab === 'lista') {
    if (ui.homeFilter === 'Urgenti') pool = pool.filter((t) => t.due_date || t.priority === 'alta');
    else if (ui.homeFilter !== 'Tutte') pool = pool.filter((t) => storesOf(t).includes(ui.homeFilter));
  }
  return pool;
}

// ---------- Render ----------

function renderAll() {
  if (!me || !me.approved) return;
  if (ui.tv) {
    renderTv();
    return;
  }
  renderHeader();
  renderMobileChips();
  renderSidebar();
  renderList();
  renderCart();
  renderToast();
  renderDetail();
  renderBnav();
}

function renderHeader() {
  const total = tasks.filter((t) => !t.pending).length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const open = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;

  const now = new Date();
  $('mDate').textContent = now
    .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(/^./, (c) => c.toUpperCase());
  $('mTitle').innerHTML = `${open} cose da fare<br>in casa nuova`;
  $('mBarFill').style.width = `${pct}%`;
  $('mPct').textContent = `${pct}%`;

  $('mAvatars').replaceChildren(
    ...(config.users || []).slice(0, 3).map((name) => {
      const a = el('div', 'avatar', name.charAt(0).toUpperCase());
      a.style.background = ownerGradient(name);
      a.title = name;
      return a;
    })
  );

  $('progressLabelD').textContent = `${pct}% fatte`;
  $('doneCountD').textContent = done;
  $('progressRing').style.background = `conic-gradient(#1aa88c ${pct}%, rgba(27,26,23,.12) 0)`;
}

function fchip(label, count, on, onClick) {
  const b = el('button', 'fchip' + (on ? ' on' : ''));
  b.append(label);
  if (count !== null && count !== undefined) {
    const n = el('span', 'n', String(count));
    b.append(' ', n);
  }
  b.addEventListener('click', onClick);
  return b;
}

function topStores(pool, max = 3) {
  const counts = new Map();
  for (const t of pool) {
    if (t.status === 'done' || t.pending) continue;
    for (const s of storesOf(t)) counts.set(s, (counts.get(s) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max);
}

function renderMobileChips() {
  const box = $('mChips');
  box.hidden = ui.tab !== 'lista';
  if (box.hidden) return;
  const pool = tasks.filter(matchesSearch);
  const open = pool.filter((t) => t.status !== 'done' && !t.pending);
  const chips = [
    fchip('Tutte', open.length, ui.homeFilter === 'Tutte', () => {
      ui.homeFilter = 'Tutte';
      renderAll();
    }),
    fchip('Urgenti', open.filter((t) => t.due_date || t.priority === 'alta').length, ui.homeFilter === 'Urgenti', () => {
      ui.homeFilter = 'Urgenti';
      renderAll();
    }),
  ];
  const stores = topStores(pool);
  for (const [s, n] of stores) {
    chips.push(
      fchip(s, n, ui.homeFilter === s, () => {
        ui.homeFilter = ui.homeFilter === s ? 'Tutte' : s;
        renderAll();
      })
    );
  }
  if (ui.homeFilter !== 'Tutte' && ui.homeFilter !== 'Urgenti' && !stores.some(([s]) => s === ui.homeFilter)) {
    chips.push(fchip(`${ui.homeFilter} ✕`, null, true, () => {
      ui.homeFilter = 'Tutte';
      renderAll();
    }));
  }
  box.replaceChildren(...chips);
}

function facetValues(key) {
  const set = new Map();
  for (const t of tasks) {
    if (t.pending) continue;
    const values = key === 'store' ? storesOf(t) : t[key === 'type' ? 'category' : key] ? [t[key === 'type' ? 'category' : key]] : [];
    for (const v of values) set.set(v, (set.get(v) || 0) + 1);
  }
  return [...set.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
}

function renderSidebar() {
  if (!isDesktop.matches) return;
  const done = tasks.filter((t) => t.status === 'done').length;
  const views = [
    ['Tutte', tasks.filter((t) => !t.pending).length, false],
    ['Con scadenza', tasks.filter((t) => t.due_date && t.status !== 'done').length, true],
    ['Assegnate a me', tasks.filter((t) => t.status !== 'done' && ownersOf(t).some((o) => o.toLowerCase() === (me.name || '').toLowerCase())).length, false],
    ['Fatte', done, false],
  ];
  $('viewsList').replaceChildren(
    ...views.map(([label, count, red]) => {
      const b = el('button', 'view-item' + (ui.view === label ? ' on' : ''));
      b.appendChild(el('span', null, label));
      b.appendChild(el('span', 'cnt' + (red ? ' red' : ''), String(count)));
      b.addEventListener('click', () => {
        ui.view = label;
        renderAll();
      });
      return b;
    })
  );
  const mkChips = (target, values, key) => {
    $(target).replaceChildren(
      ...values.map((v) => {
        const b = el('button', 'pchip' + (ui[key] === v ? ' on' : ''), v);
        b.addEventListener('click', () => {
          ui[key] = ui[key] === v ? null : v;
          renderAll();
        });
        return b;
      })
    );
  };
  mkChips('sideStores', facetValues('store'), 'store');
  mkChips('sideRooms', facetValues('room'), 'room');
  mkChips('sideTypes', facetValues('type'), 'type');
}

function renderList() {
  const area = $('listArea');
  const desktop = isDesktop.matches;
  const shopMode = !desktop && ui.tab === 'negozi';
  $('shopHead').hidden = !shopMode;

  if (shopMode) return renderShop(area);

  const pool = currentPool();
  const groups = [];

  if (!desktop && ui.tab === 'stanze') {
    const rooms = new Map();
    for (const t of pool.filter((x) => !x.parked)) {
      const key = t.room || 'Senza stanza';
      if (!rooms.has(key)) rooms.set(key, []);
      rooms.get(key).push(t);
    }
    for (const [room, items] of [...rooms.entries()].sort((a, b) => b[1].length - a[1].length)) {
      groups.push(groupEl(`${room} · ${items.length}`, items.sort(byDue)));
    }
  } else if (!desktop && ui.tab === 'fatte') {
    const done = pool.filter((t) => t.status === 'done').sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
    if (done.length) groups.push(groupEl(`Fatte · ${done.length}`, done));
  } else {
    const active = pool.filter((t) => !t.parked && (desktop && ui.view === 'Fatte' ? t.status === 'done' : true));
    const withDue = active.filter((t) => t.due_date).sort(byDue);
    const noDue = active.filter((t) => !t.due_date).sort(byCreated);
    const parked = pool.filter((t) => t.parked && t.status !== 'done');
    if (withDue.length) groups.push(groupEl(`In scadenza · ${withDue.length}`, withDue, { red: true, hint: 'ordina: scadenza ↓' }));
    if (noDue.length) groups.push(groupEl(`Senza scadenza · ${noDue.length}`, noDue, { hint: 'le fatte restano al loro posto' }));
    if (parked.length) groups.push(groupEl(`In fondo · ${parked.length}`, parked.sort(byCreated)));
  }

  area.replaceChildren(...groups);
  $('emptyState').hidden = groups.length > 0;
}

function shopCard(t) {
  const inCart = ui.cart.has(t.id) || t.status === 'done';
  const card = el('div', 'task' + (inCart && t.status !== 'done' ? ' incart' : ''));
  card.style.alignItems = 'center';
  if (celebrating.has(t.id)) {
    card.classList.add('tuck');
    addCelebration(card);
  }
  const ck = el('span', 'ck' + (inCart ? ' on' : ''));
  if (inCart) ck.appendChild(svgIcon(['m5 13 4 4 10-10']));
  card.appendChild(ck);
  const body = el('div', 'task-body');
  body.appendChild(el('div', 'task-title', t.title));
  const tags = el('div', 'task-tags');
  tagEls(t).forEach((x) => tags.appendChild(x));
  body.appendChild(tags);
  card.appendChild(body);
  card.appendChild(ownersEl(t, true));
  card.addEventListener('click', () => {
    if (t.status === 'done') return;
    if (ui.cart.has(t.id)) ui.cart.delete(t.id);
    else ui.cart.add(t.id);
    renderAll();
  });
  attachLongPress(card, () => openEdit(t));
  return card;
}

function renderShop(area) {
  const stores = topStores(tasks.filter(matchesSearch), 8);
  if (!ui.shopStore || !stores.some(([s]) => s === ui.shopStore)) {
    ui.shopStore = stores[0]?.[0] || null;
  }
  $('shopChips').replaceChildren(
    ...stores.map(([s, n]) =>
      fchip(s, n, ui.shopStore === s, () => {
        ui.shopStore = s;
        ui.cart = new Set();
        renderAll();
      })
    )
  );
  if (!ui.shopStore) {
    $('shopNote').textContent = '';
    $('shopSummary').textContent = '';
    area.replaceChildren();
    $('emptyState').hidden = false;
    return;
  }
  $('shopNote').textContent = `Filtro negozio = ${ui.shopStore} · escluse le già fatte`;
  const items = tasks
    .filter(matchesSearch)
    .filter((t) => storesOf(t).includes(ui.shopStore) && (t.status !== 'done' || celebrating.has(t.id)))
    .sort(byDue);
  const est = items.reduce((a, t) => a + (t.cost || 0), 0);
  $('shopSummary').textContent = `${items.length} attività · stima ${Math.round(est)} €`;
  const box = el('div', 'group-items');
  items.forEach((t) => box.appendChild(shopCard(t)));
  area.replaceChildren(box);
  $('emptyState').hidden = items.length > 0;
}

function renderCart() {
  const bar = $('cartBar');
  const active = !isDesktop.matches && ui.tab === 'negozi';
  bar.hidden = !active;
  if (!active) return;
  const ids = [...ui.cart];
  const sum = ids.reduce((a, id) => a + (tasks.find((t) => t.id === id)?.cost || 0), 0);
  bar.replaceChildren();
  const left = el('div');
  left.style.flex = '1';
  left.appendChild(el('div', 'lbl', ids.length ? `${ids.length} nel carrello` : 'Nessuna selezione'));
  left.appendChild(el('div', 'sub', ids.length ? `stima ${Math.round(sum)} €` : 'tocca le righe per aggiungerle'));
  bar.appendChild(left);
  const go = el('button', 'go' + (ids.length ? '' : ' off'), 'Segna comprate');
  if (ids.length) {
    go.addEventListener('click', () =>
      bulkDone(ids, `${ids.length} ${ids.length === 1 ? 'cosa comprata' : 'cose comprate'} da ${ui.shopStore}`)
    );
  }
  bar.appendChild(go);
}

function renderToast() {
  const wrap = $('toastWrap');
  wrap.replaceChildren();
  if (!ui.toast) return;
  const t = el('div', 'toast');
  t.appendChild(el('span', 'msg', ui.toast.msg));
  if (ui.toast.ids?.length) {
    const undo = el('button', 'undo', 'Annulla');
    undo.addEventListener('click', undoToast);
    t.appendChild(undo);
  }
  wrap.appendChild(t);
}

function renderDetail() {
  if (!isDesktop.matches) return;
  const panel = $('detailPanel');
  const sel = tasks.find((t) => t.id === ui.selectedId) || tasks.find((t) => !t.pending);
  panel.replaceChildren();
  if (!sel) {
    panel.appendChild(el('div', 'detail-placeholder', 'Seleziona un’attività per vedere i dettagli.'));
    return;
  }
  const due = fmtDue(sel.due_date);
  const head = el('div', 'detail-due');
  const pill = el(
    'span',
    'tag ' + (sel.status === 'done' ? 'store' : due ? 'due' + (due.hot ? ' hot' : '') : ''),
    sel.status === 'done' ? 'Completata' : due ? `Scade ${due.label.toLowerCase()}` : 'Senza scadenza'
  );
  head.appendChild(pill);
  panel.appendChild(head);
  panel.appendChild(el('div', 'detail-title' + (sel.status === 'done' ? ' done' : ''), sel.title));

  const chips = el('div', 'detail-chips');
  for (const s of storesOf(sel)) chips.appendChild(el('span', 'tag store', s));
  if (sel.room) chips.appendChild(el('span', 'tag', sel.room));
  if (sel.category) chips.appendChild(el('span', 'tag', sel.category));
  if (sel.num) chips.appendChild(el('span', 'tag num', `#${sel.num}`));
  panel.appendChild(chips);

  const ownersRow = el('div', 'detail-row');
  ownersRow.appendChild(el('span', 'k', 'Di chi è'));
  ownersRow.appendChild(ownersEl(sel, true));
  panel.appendChild(ownersRow);

  const costRow = el('div', 'detail-row');
  costRow.appendChild(el('span', 'k', 'Costo stimato'));
  costRow.appendChild(el('span', 'v', sel.cost ? `${Math.round(sel.cost)} €` : '—'));
  panel.appendChild(costRow);

  panel.appendChild(el('div', 'detail-sec', 'Note'));
  panel.appendChild(el('div', 'detail-note', sel.notes || 'Nessuna nota. Aprila con Modifica per aggiungerne una.'));

  const actions = el('div', 'detail-actions');
  const doneBtn = el('button', 'btn' + (sel.status === 'done' ? '' : ' btn-primary'), sel.status === 'done' ? 'Riapri' : 'Fatta');
  doneBtn.addEventListener('click', () => toggleDone(sel));
  const parkBtn = el('button', 'btn', sel.parked ? 'Riporta su' : 'Rimanda');
  parkBtn.addEventListener('click', () => setParked(sel, !sel.parked));
  actions.append(doneBtn, parkBtn);
  panel.appendChild(actions);

  const editRow = el('div', 'detail-edit');
  const editBtn = el('button', null, '✏️ Modifica');
  editBtn.addEventListener('click', () => openEdit(sel));
  editRow.appendChild(editBtn);
  panel.appendChild(editRow);
}

function renderBnav() {
  $$('#bnav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === ui.tab));
}

// ---------- Modalità TV ----------

function enterTv() {
  ui.tv = true;
  try { localStorage.setItem('tvMode', '1'); } catch {}
  show('view-tv');
  renderTv();
  clearInterval(tvPoll);
  tvPoll = setInterval(async () => {
    try {
      await loadTasks();
      renderTv();
    } catch {}
  }, 30000);
}

function exitTv() {
  ui.tv = false;
  try { localStorage.setItem('tvMode', '0'); } catch {}
  clearInterval(tvPoll);
  show('view-app');
  renderAll();
}

function renderTv() {
  const open = tasks.filter((t) => t.status !== 'done' && !t.pending);
  const done = tasks.filter((t) => t.status === 'done').length;
  $('tvDate').textContent = `${new Date()
    .toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(/^./, (c) => c.toUpperCase())} · ${open.length} da fare`;

  const dueTasks = open.filter((t) => t.due_date).sort(byDue).slice(0, 3);
  const list = $('tvDueList');
  list.replaceChildren();
  if (!dueTasks.length) {
    const clear = el('div', 'tv-clear');
    clear.innerHTML = 'Nessuna scadenza aperta.<br>Casa in pari.';
    list.appendChild(clear);
  } else {
    for (const t of dueTasks) {
      const due = fmtDue(t.due_date);
      const row = el('div', 'tv-due' + (due?.hot ? ' hot' : ''));
      const left = el('div');
      left.style.cssText = 'flex:1;min-width:0';
      left.appendChild(el('div', 't', t.title));
      const meta = [t.room || t.category, ownersOf(t).join(' e ')].filter(Boolean).join(' · ');
      if (meta) left.appendChild(el('div', 'm', meta));
      row.appendChild(left);
      row.appendChild(el('span', 'pill', (due?.label || '').toUpperCase()));
      list.appendChild(row);
    }
  }

  const storeCounts = new Map();
  for (const t of open) for (const s of storesOf(t)) storeCounts.set(s, (storeCounts.get(s) || 0) + 1);
  $('tvStores').replaceChildren(
    ...[...storeCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([s, n]) => {
        const row = el('div', 'tv-store');
        row.appendChild(el('span', 's', s));
        row.appendChild(el('span', 'c', String(n)));
        return row;
      })
  );
  $('tvHomeCount').textContent = open.filter((t) => !storesOf(t).length).length;
  $('tvDoneCount').textContent = done;
}

// Riclassificazione generale
$$('.reclassAllBtn').forEach((btn) =>
  btn.addEventListener('click', async () => {
    const openCount = tasks.filter((t) => t.status !== 'done' && !t.pending).length;
    if (!openCount) return alert('Non ci sono attività da fare da riclassificare.');
    if (!confirm(`Riclassificare con l'AI le ${openCount} attività da fare? Titolo e tag verranno riassegnati (gli assegnatari restano).`)) return;
    $$('.reclassAllBtn').forEach((b) => {
      b.disabled = true;
      b.textContent = '⏳';
    });
    try {
      const result = await api('/api/tasks/reclassify-all', { method: 'POST' });
      await loadTasks();
      showToast(`${result.updated} attività riclassificate ✨`, []);
    } catch (err) {
      alert(`Errore: ${err.message}`);
    }
    $$('.reclassAllBtn').forEach((b) => {
      b.disabled = false;
      b.textContent = '✨';
    });
    renderAll();
  })
);

$('tvExit').addEventListener('click', exitTv);
$('tvBtnD').addEventListener('click', enterTv);
$('tvBtnM').addEventListener('click', enterTv);

// ---------- Aggiunta ----------

const addDialog = $('addDialog');
const addForm = $('addForm');
let addMode = 'una';
let photoData = null;

function setAddMode(mode) {
  addMode = mode;
  $$('#addModes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  $('addSingleWrap').hidden = mode !== 'una';
  $('addListWrap').hidden = mode !== 'elenco';
  $('addPhotoWrap').hidden = mode !== 'foto';
  $('addError').hidden = true;
}
$$('#addModes button').forEach((b) => b.addEventListener('click', () => setAddMode(b.dataset.mode)));

function openAdd() {
  addForm.reset();
  photoData = null;
  $('photoPreview').hidden = true;
  $('photoHint').hidden = true;
  setAddMode('una');
  addDialog.showModal();
}
$('fabAdd').addEventListener('click', openAdd);
$('addBtnD').addEventListener('click', openAdd);
$('cancelAddBtn').addEventListener('click', () => addDialog.close());

async function resizeImage(file, max = 1600) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', base64: dataUrl.split(',')[1] };
}

$('pickPhotoBtn').addEventListener('click', () => $('photoInput').click());
$('photoInput').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    photoData = await resizeImage(file);
    const img = $('photoPreview');
    img.src = `data:${photoData.mediaType};base64,${photoData.base64}`;
    img.hidden = false;
    $('photoHint').hidden = false;
    $('addError').hidden = true;
  } catch {
    $('addError').textContent = 'Non riesco a leggere questa immagine, prova con un altro formato';
    $('addError').hidden = false;
  }
});

addForm.addEventListener('submit', async (e) => {
  $('addError').hidden = true;

  if (addMode === 'una') {
    const text = addForm.text.value.trim();
    if (!text) {
      e.preventDefault();
      return;
    }
    const temp = { id: `tmp-${Date.now()}`, title: text, status: 'open', pending: true, created_at: new Date().toISOString(), parked: 0 };
    tasks.unshift(temp);
    renderAll();
    try {
      const created = await api('/api/tasks', { method: 'POST', body: { text } });
      tasks.splice(tasks.indexOf(temp), 1, created);
      if (isDesktop.matches) ui.selectedId = created.id;
    } catch (err) {
      tasks.splice(tasks.indexOf(temp), 1);
      alert(`Errore: ${err.message}`);
    }
    renderAll();
    return;
  }

  // Elenco o foto: resta nel dialog finché l'analisi non è finita
  e.preventDefault();
  const btn = $('addSubmitBtn');
  btn.disabled = true;
  btn.textContent = addMode === 'foto' ? '✨ Leggo la foto…' : '✨ Analizzo…';
  try {
    let created;
    if (addMode === 'elenco') {
      const text = addForm.list.value.trim();
      if (!text) throw new Error('Scrivi almeno una voce');
      created = await api('/api/tasks/bulk', { method: 'POST', body: { text } });
    } else {
      if (!photoData) throw new Error('Scegli prima una foto della lista');
      created = await api('/api/tasks/photo', { method: 'POST', body: { image: photoData.base64, mediaType: photoData.mediaType } });
    }
    tasks.unshift(...created);
    addDialog.close();
    showToast(`${created.length} attività aggiunte ✨`, []);
    renderAll();
  } catch (err) {
    $('addError').textContent = err.message;
    $('addError').hidden = false;
  }
  btn.disabled = false;
  btn.textContent = 'Aggiungi';
});

// ---------- Ricerca ----------

for (const id of ['searchMobile', 'searchDesktop']) {
  $(id).addEventListener('input', (e) => {
    ui.q = e.target.value.trim();
    renderAll();
  });
}

// ---------- Tab mobile ----------

$$('#bnav button').forEach((b) =>
  b.addEventListener('click', () => {
    ui.tab = b.dataset.tab;
    ui.cart = new Set();
    renderAll();
  })
);

// ---------- Modifica ----------

let editingTask = null;
const editDialog = $('editDialog');
const editForm = $('editForm');

function fillDatalist(id, values, defaults) {
  const box = $(id);
  box.replaceChildren();
  for (const v of new Set([...values, ...defaults])) {
    const opt = document.createElement('option');
    opt.value = v;
    box.appendChild(opt);
  }
}

let editOwners = new Set();

function renderOwnerPicker() {
  const names = [...new Set([...(config.users || []), ...editOwners])];
  $('ownerPicker').replaceChildren(
    ...names.map((name) => {
      const b = el('button', 'pchip' + (editOwners.has(name) ? ' on' : ''), name);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (editOwners.has(name)) editOwners.delete(name);
        else editOwners.add(name);
        renderOwnerPicker();
      });
      return b;
    })
  );
}

function openEdit(t) {
  editingTask = t;
  $('editTitle').textContent = t.num ? `Modifica attività #${t.num}` : 'Modifica attività';
  editForm.title.value = t.title || '';
  editForm.store.value = storesOf(t).join(', ');
  editForm.room.value = t.room || '';
  editForm.category.value = t.category || '';
  editForm.due_date.value = t.due_date || '';
  editForm.cost.value = t.cost ? Math.round(t.cost) : '';
  editOwners = new Set(ownersOf(t));
  renderOwnerPicker();
  editForm.priority.value = t.priority || 'media';
  editForm.notes.value = t.notes || '';
  fillDatalist('storeOptions', tasks.flatMap(storesOf), ['IKEA', 'Leroy Merlin', 'Brico', 'OBI', 'Amazon', 'Supermercato', 'Ferramenta']);
  fillDatalist('roomOptions', tasks.map((x) => x.room).filter(Boolean), ['Cucina', 'Bagno', 'Camera', 'Soggiorno', 'Corridoio', 'Balcone', 'Garage', 'Studio', 'Tutta casa']);
  fillDatalist('categoryOptions', tasks.map((x) => x.category).filter(Boolean), ['Acquisto', 'Montaggio', 'Riparazione', 'Pulizia', 'Elettricità', 'Idraulica', 'Decorazione', 'Burocrazia', 'Chiamare', 'Trasloco', 'Altro']);
  editDialog.showModal();
}

editForm.addEventListener('submit', async () => {
  if (!editingTask) return;
  const body = {
    title: editForm.title.value.trim(),
    store: splitList(editForm.store.value).join(', '),
    room: editForm.room.value.trim(),
    category: editForm.category.value.trim(),
    due_date: editForm.due_date.value,
    cost: editForm.cost.value ? Number(editForm.cost.value) : '',
    owners: [...editOwners].join(', '),
    priority: editForm.priority.value,
    notes: editForm.notes.value.trim(),
  };
  try {
    const updated = await api(`/api/tasks/${editingTask.id}`, { method: 'PATCH', body });
    Object.assign(editingTask, updated);
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
  editingTask = null;
  renderAll();
});

$('cancelEditBtn').addEventListener('click', () => editDialog.close());

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
  editDialog.close();
  renderAll();
});

$('reclassifyBtn').addEventListener('click', async () => {
  if (!editingTask) return;
  const btn = $('reclassifyBtn');
  btn.disabled = true;
  btn.textContent = '✨ Analizzo…';
  try {
    const updated = await api(`/api/tasks/${editingTask.id}/reclassify`, { method: 'POST' });
    Object.assign(editingTask, updated);
    editDialog.close();
    editingTask = null;
    renderAll();
  } catch (err) {
    alert(`Errore: ${err.message}`);
  }
  btn.disabled = false;
  btn.textContent = '✨ Riclassifica';
});

// ---------- Admin ----------

$$('.adminBtn').forEach((b) => b.addEventListener('click', showAdmin));
$('adminBackBtn').addEventListener('click', () => {
  show('view-app');
  loadTasks().then(renderAll);
});

async function showAdmin() {
  show('view-admin');
  const users = await api('/api/users');
  $('userList').replaceChildren(
    ...users.map((u) => {
      const li = el('li', 'user-row');
      const avatar = document.createElement('img');
      avatar.className = 'user-avatar';
      avatar.src =
        u.picture ||
        'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="70" x="15">👤</text></svg>');
      avatar.alt = '';
      const info = el('div', 'user-info');
      const line = el('div');
      line.append(u.name || 'Senza nome', ' ');
      if (u.isAdmin) line.appendChild(el('span', 'badge', 'admin'));
      line.append(' ');
      line.appendChild(el('span', 'badge' + (u.approved ? ' ok' : ''), u.approved ? 'approvato' : 'in attesa'));
      info.appendChild(line);
      info.appendChild(el('div', 'email', u.email));
      const btn = el('button', 'btn' + (u.approved ? '' : ' btn-primary'), u.approved ? 'Revoca' : 'Approva');
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

// ---------- Avvio ----------

(async function start() {
  const TV_AUTO = /silk|aft\w|smart-?tv|crkey|tizen|webos/i.test(navigator.userAgent);
  try {
    const stored = localStorage.getItem('tvMode');
    ui.tv = stored === null ? TV_AUTO : stored === '1';
  } catch {
    ui.tv = TV_AUTO;
  }
  try {
    config = await api('/api/config');
  } catch {}
  try {
    me = await api('/api/me');
  } catch {
    me = null;
  }
  route();
})();
