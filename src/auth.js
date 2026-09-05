// Autenticazione: login Google (ID token verificato lato server) + sessione via cookie firmato.
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { query, newId, now } from './db.js';

export const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';

// Modalità di accesso: con GOOGLE_CLIENT_ID si usa la login Google;
// senza, l'accesso è un'autodichiarazione tra i nomi di SIMPLE_USERS ("Chi sei?").
export const SIMPLE_USERS = (process.env.SIMPLE_USERS || 'Andrea,Stefania,Brunello')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
export const AUTH_MODE = GOOGLE_CLIENT_ID ? 'google' : 'simple';

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.SESSION_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[auth] SESSION_SECRET non impostato: le sessioni si azzerano a ogni riavvio.');
}

const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

export async function verifyGoogleCredential(credential) {
  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.email || !payload.email_verified) {
    throw new Error('Email Google non verificata');
  }
  return { email: payload.email, name: payload.name, picture: payload.picture };
}

export async function findOrCreateUser({ email, name, picture }) {
  const normalized = email.toLowerCase();
  const isAdminEmail = ADMIN_EMAILS.includes(normalized);
  const rows = await query('SELECT * FROM users WHERE email = $1', [normalized]);
  if (rows.length) {
    const user = rows[0];
    // Promozione automatica se l'email è stata aggiunta ad ADMIN_EMAILS dopo il primo login
    if (isAdminEmail && (!user.is_admin || !user.approved)) {
      await query('UPDATE users SET is_admin = 1, approved = 1 WHERE id = $1', [user.id]);
      user.is_admin = 1;
      user.approved = 1;
    }
    return user;
  }
  const id = newId();
  await query(
    'INSERT INTO users (id, email, name, picture, approved, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, normalized, name || '', picture || '', isAdminEmail ? 1 : 0, isAdminEmail ? 1 : 0, now()]
  );
  return (await query('SELECT * FROM users WHERE id = $1', [id]))[0];
}

// Accesso semplice: il primo nome della lista è l'admin
export async function findOrCreateSimpleUser(name) {
  const match = SIMPLE_USERS.find((u) => u.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!match) return null;
  const email = `${match.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@famiglia.local`;
  const rows = await query('SELECT * FROM users WHERE email = $1', [email]);
  if (rows.length) return rows[0];
  const id = newId();
  const isAdmin = SIMPLE_USERS[0] === match ? 1 : 0;
  await query(
    'INSERT INTO users (id, email, name, picture, approved, is_admin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [id, email, match, '', 1, isAdmin, now()]
  );
  return (await query('SELECT * FROM users WHERE id = $1', [id]))[0];
}

export function setSessionCookie(res, userId) {
  const token = jwt.sign({ uid: userId }, SECRET, { expiresIn: '90d' });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 90 * 24 * 3600 * 1000,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie('session');
}

export async function currentUser(req) {
  const token = req.cookies?.session;
  if (!token) return null;
  try {
    const { uid } = jwt.verify(token, SECRET);
    const rows = await query('SELECT * FROM users WHERE id = $1', [uid]);
    return rows[0] || null;
  } catch {
    return null;
  }
}

export function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    picture: user.picture,
    approved: Boolean(user.approved),
    isAdmin: Boolean(user.is_admin),
  };
}

// Middleware
export async function requireUser(req, res, next) {
  const user = await currentUser(req);
  if (!user) return res.status(401).json({ error: 'Non autenticato' });
  req.user = user;
  next();
}

export function requireApproved(req, res, next) {
  if (!req.user?.approved) {
    return res.status(403).json({ error: 'Account in attesa di approvazione' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Riservato agli amministratori' });
  }
  next();
}
