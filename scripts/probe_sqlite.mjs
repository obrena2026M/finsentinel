// Probe Node's built-in SQLite for features the Workbench needs.
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
console.log('sqlite version:', db.prepare('select sqlite_version() v').get().v);

try {
  db.exec('create virtual table d using fts5(body)');
  db.prepare('insert into d values (?)').run('AML policy section 5.3 transaction monitoring');
  const hits = db.prepare("select count(*) c from d where d match 'monitoring'").get().c;
  console.log('FTS5: OK, hits =', hits);
} catch (e) {
  console.log('FTS5: missing ->', e.message);
}

try {
  const j = db.prepare(`select json_extract('{"a":1}', '$.a') j`).get().j;
  console.log('JSON1: OK, json_extract =', j);
} catch (e) {
  console.log('JSON1: missing ->', e.message);
}

const opts = db
  .prepare('pragma compile_options')
  .all()
  .map((r) => Object.values(r)[0]);
console.log('compile options:', opts.filter((o) => /FTS|JSON|RTREE|THREADSAFE/.test(o)).join(', '));
