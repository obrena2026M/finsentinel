import { seedDemoCases } from '../src/db/seed-demo.ts';
import { createContext } from '../src/server.ts';

// Seeds reference data and demo cases into DB_PATH. Refuses in production unless ALLOW_SEED is set.
if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_SEED) {
  console.error('refusing to seed in production without ALLOW_SEED=1');
  process.exit(1);
}
const ctx = await createContext();
const r = await seedDemoCases(ctx);
console.log(
  r.created.length ? `demo cases created: ${r.created.join(', ')}` : 'cases already exist; nothing seeded',
);
ctx.db.close();
