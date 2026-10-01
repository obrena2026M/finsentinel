import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
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

// STAGE06 OPS-06: optional retention, e.g. --keep-days=14 (scripts/ops.ps1 daily task).
const keepArg = process.argv.find((a) => a.startsWith('--keep-days='));
if (keepArg) {
  const days = Number(keepArg.slice('--keep-days='.length));
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  let removed = 0;
  for (const f of readdirSync(dir)) {
    if (!/^finsentinel-.*.db$/.test(f)) continue;
    const p = join(dir, f);
    if (statSync(p).mtimeMs < cutoff) {
      unlinkSync(p);
      removed++;
    }
  }
  console.log(`retention: kept backups newer than ${days} days, removed ${removed}`);
}
