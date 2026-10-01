import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { loadEnv } from '../src/config/env.ts';

// NFR-OPS-07 / DEP-11: restore the SQLite database from a backup written by `npm run backup`.
// node --env-file=.env scripts/restore.ts --latest | --from=data/backups/<file>.db  [--yes]
// Stop the server first: the restore replaces the database file (and removes WAL/SHM side files).

const env = loadEnv();
const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.slice(n.length + 3);
const flag = (n: string) => process.argv.includes(`--${n}`);

if (env.DB_PATH === ':memory:') {
  console.error('nothing to restore into an in-memory database');
  process.exit(1);
}
const dir = process.env.BACKUP_DIR || join('data', 'backups');
let source = arg('from');
if (!source && flag('latest')) {
  const files = existsSync(dir)
    ? readdirSync(dir)
        .filter((f) => f.endsWith('.db'))
        .sort()
    : [];
  source = files.length ? join(dir, files[files.length - 1]!) : undefined;
}
if (!source) {
  console.error('usage: restore.ts --latest | --from=<backup.db> [--yes]');
  process.exit(2);
}
if (!existsSync(source)) {
  console.error(`backup not found: ${source}`);
  process.exit(2);
}

// 1. Verify the backup before touching anything.
const check = new DatabaseSync(source, { readOnly: true });
const integrity = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string })
  .integrity_check;
const cases = (check.prepare('SELECT COUNT(*) n FROM cases').get() as { n: number }).n;
const audit = (check.prepare('SELECT COUNT(*) n FROM audit_events').get() as { n: number }).n;
check.close();
if (integrity !== 'ok') {
  console.error(`backup failed integrity check: ${integrity}`);
  process.exit(1);
}
console.log(
  `backup ${source}: integrity ok, ${cases} cases, ${audit} audit events, ${statSync(source).size} bytes`,
);

if (!flag('yes')) {
  console.log(
    `dry run. Re-run with --yes to replace ${env.DB_PATH} (the current file is kept as a .pre-restore copy).`,
  );
  process.exit(0);
}

// 2. Keep the current database aside, then replace it.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
if (existsSync(env.DB_PATH)) {
  const keep = `${env.DB_PATH}.pre-restore-${stamp}`;
  copyFileSync(env.DB_PATH, keep);
  console.log(`current database kept as ${keep}`);
}
for (const side of ['-wal', '-shm']) if (existsSync(env.DB_PATH + side)) rmSync(env.DB_PATH + side);
copyFileSync(source, env.DB_PATH);

// 3. Confirm the restored file opens and is consistent.
const restored = new DatabaseSync(env.DB_PATH);
const ok = (restored.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
restored.close();
console.log(
  ok === 'ok' ? `restored ${env.DB_PATH} from ${source}` : `restored file failed integrity check: ${ok}`,
);
process.exit(ok === 'ok' ? 0 : 1);
