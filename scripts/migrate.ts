import { loadEnv } from '../src/config/env.ts';
import { openDatabase, runMigrations } from '../src/db/connection.ts';

const env = loadEnv();
const db = openDatabase(env.DB_PATH);
const ran = runMigrations(db);
console.log(ran.length ? `applied: ${ran.join(', ')}` : 'schema up to date');
db.close();
