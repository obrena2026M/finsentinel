import { z } from 'zod';

/**
 * Strict boolean for environment flags. `z.coerce.boolean()` treats "0" and "false" as true
 * (Boolean("0") === true), which would silently enable demo seeding in production (DEP-07).
 */
const envFlag = (defaultValue: boolean) =>
  z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v, ctx) => {
      if (v === undefined || v === '') return defaultValue;
      if (typeof v === 'boolean') return v;
      const s = v.trim().toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(s)) return true;
      if (['0', 'false', 'no', 'off'].includes(s)) return false;
      ctx.addIssue({ code: 'custom', message: `expected a boolean flag (1/0/true/false), got "${v}"` });
      return z.NEVER;
    });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  /** Bind address. 127.0.0.1 for local/demo; 0.0.0.0 behind a reverse proxy or in a container (DEP-05). */
  HOST: z.string().min(1).default('127.0.0.1'),
  DB_PATH: z.string().default('./data/finsentinel.db'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  AUTH_MODE: z.enum(['simulation', 'password']).default('simulation'),
  LLM_GATEWAY: z.enum(['mock', 'anthropic']).default('mock'),
  ANTHROPIC_API_KEY: z.string().optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  SEED_ON_START: envFlag(false),
  /** Explicit opt-in to seed synthetic demo data when NODE_ENV=production (DEP-07, NFR-SEC-10). */
  ALLOW_SEED: envFlag(false),
  UPLOAD_DIR: z.string().default('./data/uploads'),
  /** Simulated per-call latency of the mock LLM gateway so the pipeline is visibly "working" in demos. */
  MOCK_LATENCY_MS: z.coerce.number().int().min(0).default(0),
  /** Honour X-Forwarded-* from a reverse proxy (TLS terminator) in front of the process (DEP-05). */
  TRUST_PROXY: envFlag(false),
  /** Mark the session cookie Secure; required whenever the app is served over HTTPS (DEP-05, NFR-SEC-09). */
  COOKIE_SECURE: envFlag(false),
  /** Comma-separated list of allowed browser origins. Unset = reflect the request origin (local dev only). */
  CORS_ORIGIN: z.string().optional(),
  NODE_ENV: z.string().optional(),
  /** Release identity written by scripts/deploy.ps1 (git short SHA); reported by /health/live (DEP-09). */
  BUILD_SHA: z.string().optional(),
});

export type Env = z.infer<typeof EnvSchema> & { corsOrigins: string[] | true };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const r = EnvSchema.safeParse(source);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment: ${msg}`);
  }
  const env = r.data;
  if (env.LLM_GATEWAY === 'anthropic' && !env.ANTHROPIC_API_KEY) {
    throw new Error('LLM_GATEWAY=anthropic requires ANTHROPIC_API_KEY');
  }
  if (env.NODE_ENV === 'production' && env.SEED_ON_START && !env.ALLOW_SEED) {
    throw new Error(
      'SEED_ON_START=1 is refused when NODE_ENV=production unless ALLOW_SEED=1 (synthetic demo data only)',
    );
  }
  const corsOrigins: string[] | true = env.CORS_ORIGIN
    ? env.CORS_ORIGIN.split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : true;
  return { ...env, corsOrigins };
}
