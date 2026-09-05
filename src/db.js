// Strato dati: Postgres (produzione, via DATABASE_URL) o SQLite (sviluppo locale).
// Le query usano sempre placeholder $1, $2, ... in ordine crescente e senza ripetizioni.
import { randomUUID } from 'node:crypto';

const usePg = Boolean(process.env.DATABASE_URL);

let query;

if (usePg) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === '1' ? { rejectUnauthorized: false } : undefined,
  });
  query = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
  };
} else {
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(process.env.SQLITE_PATH || './data.sqlite');
  sqlite.pragma('journal_mode = WAL');
  query = async (sql, params = []) => {
    const converted = sql.replace(/\$\d+/g, '?');
    const stmt = sqlite.prepare(converted);
    if (stmt.reader) return stmt.all(...params);
    stmt.run(...params);
    return [];
  };
}

export { query };

export function newId() {
  return randomUUID();
}

export function now() {
  return new Date().toISOString();
}

export async function init() {
  await query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    picture TEXT,
    approved INTEGER NOT NULL DEFAULT 0,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`);
  await query(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    original_text TEXT,
    store TEXT,
    room TEXT,
    category TEXT,
    priority TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    notes TEXT,
    ai_source TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    done_at TEXT
  )`);
  // Migrazioni additive: ignora l'errore se la colonna esiste già
  const addColumn = async (ddl) => {
    try {
      await query(ddl);
    } catch {
      /* colonna già presente */
    }
  };
  await addColumn('ALTER TABLE tasks ADD COLUMN due_date TEXT');
  await addColumn('ALTER TABLE tasks ADD COLUMN cost REAL');
  await addColumn('ALTER TABLE tasks ADD COLUMN owners TEXT');
  await addColumn('ALTER TABLE tasks ADD COLUMN parked INTEGER NOT NULL DEFAULT 0');
  console.log(`[db] pronto (${usePg ? 'Postgres' : 'SQLite locale'})`);
}
