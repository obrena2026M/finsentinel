import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

export type Db = DatabaseSync;

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

export function openDatabase(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA synchronous = NORMAL;');
  }
  db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

export function runMigrations(db: Db, dir: string = MIGRATIONS_DIR): string[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );`);
  const applied = new Set(
    (db.prepare('SELECT name FROM schema_migrations').all() as Array<{ name: string }>).map((r) => r.name),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const ran: string[] = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(dir, f), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(
        f,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
      ran.push(f);
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`migration ${f} failed: ${(e as Error).message}`);
    }
  }
  return ran;
}

/** Run `fn` inside a transaction; nested calls join the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  const inTx = db.prepare('SELECT 1').get() !== undefined && isInTransaction(db);
  if (inTx) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function isInTransaction(db: Db): boolean {
  // node:sqlite exposes isTransaction on newer versions; fall back to a probe.
  const anyDb = db as unknown as { isTransaction?: boolean };
  if (typeof anyDb.isTransaction === 'boolean') return anyDb.isTransaction;
  try {
    db.exec('SAVEPOINT __probe');
    db.exec('RELEASE __probe');
    return false;
  } catch {
    return true;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
