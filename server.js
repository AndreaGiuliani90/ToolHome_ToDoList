import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { init, query, newId, now } from './src/db.js';
import {
  GOOGLE_CLIENT_ID,
  DEV_LOGIN,
  verifyGoogleCredential,
  findOrCreateUser,
  setSessionCookie,
  clearSessionCookie,
  currentUser,
  publicUser,
  requireUser,
  requireApproved,
  requireAdmin,
} from './src/auth.js';
import { classify, AI_ENABLED } from './src/ai.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(here, 'public')));

// ---------- Config e autenticazione ----------

app.get('/api/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID || null, devLogin: DEV_LOGIN, aiEnabled: AI_ENABLED });
});

app.get('/api/me', async (req, res) => {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  res.json(publicUser(user));
});

app.post('/api/auth/google', async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(400).json({ error: 'Login Google non configurato' });
  try {
    const profile = await verifyGoogleCredential(req.body?.credential);
    const user = await findOrCreateUser(profile);
    setSessionCookie(res, user.id);
    res.json(publicUser(user));
  } catch (err) {
    console.error('[auth] login Google fallito:', err.message);
    res.status(401).json({ error: 'Login Google non valido' });
  }
});

app.post('/api/auth/dev', async (req, res) => {
  if (!DEV_LOGIN) return res.status(403).json({ error: 'Login di sviluppo disabilitato' });
  const user = await findOrCreateUser({ email: 'dev@localhost', name: 'Utente di sviluppo' });
  await query('UPDATE users SET approved = 1, is_admin = 1 WHERE id = $1', [user.id]);
  setSessionCookie(res, user.id);
  res.json({ ...publicUser(user), approved: true, isAdmin: true });
});

app.post('/api/auth/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------- Attività (lista condivisa tra gli utenti approvati) ----------

const TASK_FIELDS = ['title', 'store', 'room', 'category', 'priority', 'notes', 'status'];

app.get('/api/tasks', requireUser, requireApproved, async (req, res) => {
  const tasks = await query('SELECT * FROM tasks ORDER BY created_at DESC');
  res.json(tasks);
});

app.post('/api/tasks', requireUser, requireApproved, async (req, res) => {
  const text = (req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Testo mancante' });
  const c = await classify(text);
  const id = newId();
  await query(
    `INSERT INTO tasks (id, title, original_text, store, room, category, priority, status, ai_source, created_by, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [id, c.title, text, c.store, c.room, c.category, c.priority, 'open', c.ai_source, req.user.id, now()]
  );
  const rows = await query('SELECT * FROM tasks WHERE id = $1', [id]);
  res.status(201).json(rows[0]);
});

app.patch('/api/tasks/:id', requireUser, requireApproved, async (req, res) => {
  const rows = await query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Attività non trovata' });
  const task = rows[0];

  const updates = {};
  for (const field of TASK_FIELDS) {
    if (field in (req.body || {})) {
      const value = req.body[field];
      updates[field] = typeof value === 'string' && value.trim() === '' ? null : value;
    }
  }
  if (updates.status && !['open', 'done'].includes(updates.status)) {
    return res.status(400).json({ error: 'Stato non valido' });
  }
  if (updates.status) {
    updates.done_at = updates.status === 'done' ? now() : null;
  }
  const keys = Object.keys(updates);
  if (!keys.length) return res.json(task);

  const setClause = keys.map((k, i) => `${k} = $${i + 1}`).join(', ');
  await query(`UPDATE tasks SET ${setClause} WHERE id = $${keys.length + 1}`, [
    ...keys.map((k) => updates[k]),
    task.id,
  ]);
  const updated = await query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  res.json(updated[0]);
});

app.post('/api/tasks/:id/reclassify', requireUser, requireApproved, async (req, res) => {
  const rows = await query('SELECT * FROM tasks WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Attività non trovata' });
  const task = rows[0];
  const c = await classify(task.original_text || task.title);
  await query(
    'UPDATE tasks SET title = $1, store = $2, room = $3, category = $4, priority = $5, ai_source = $6 WHERE id = $7',
    [c.title, c.store, c.room, c.category, c.priority, c.ai_source, task.id]
  );
  const updated = await query('SELECT * FROM tasks WHERE id = $1', [task.id]);
  res.json(updated[0]);
});

app.delete('/api/tasks/:id', requireUser, requireApproved, async (req, res) => {
  await query('DELETE FROM tasks WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---------- Amministrazione utenti ----------

app.get('/api/users', requireUser, requireAdmin, async (req, res) => {
  const users = await query('SELECT * FROM users ORDER BY created_at ASC');
  res.json(users.map(publicUser));
});

app.post('/api/users/:id/approve', requireUser, requireAdmin, async (req, res) => {
  const approved = req.body?.approved ? 1 : 0;
  if (req.params.id === req.user.id && !approved) {
    return res.status(400).json({ error: 'Non puoi revocare il tuo stesso accesso' });
  }
  await query('UPDATE users SET approved = $1 WHERE id = $2', [approved, req.params.id]);
  const rows = await query('SELECT * FROM users WHERE id = $1', [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Utente non trovato' });
  res.json(publicUser(rows[0]));
});

app.get('/healthz', (req, res) => res.json({ ok: true }));

// ---------- Avvio ----------

const port = process.env.PORT || 3000;
await init();
app.listen(port, () => {
  console.log(`Casa Tasks in ascolto su http://localhost:${port}`);
  if (DEV_LOGIN) console.log('[auth] modalità sviluppo: login Google non configurato, attivo il login di sviluppo');
  if (!AI_ENABLED) console.log('[ai] ANTHROPIC_API_KEY assente: classificazione euristica di base');
});
