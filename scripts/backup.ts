import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/config/env.ts';
import { openDatabase } from '../src/db/connection.ts';

// NFR-OPS-07 / DEP-10: online backup via VACUUM INTO. Target dir: BACKUP_DIR (default data/backups).
const env = loadEnv();
if (env.DB_PATH === ':memory:') {
  console.error('nothing to back up for an in-memory database');
  process.exit(1);
}
const dir = process.env.BACKUP_DIR || join('data', 'backups');
mkdirSync(dir, { recursive: true });
const target = join(dir, `finsentinel-${new Date().toISOString().replace(/[:.]/g, '-')}.db`).replace(
  /\\/g,
  '/',
);
const db = openDatabase(env.DB_PATH);
db.exec(`VACUUM INTO '${target}'`);
db.close();
console.log(`backup written: ${target}`);
