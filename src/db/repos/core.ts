import { randomUUID } from 'node:crypto';
import type { Role } from '../../domain/rbac.ts';
import { parseRiskModel, type RiskModel } from '../../domain/risk-model-schema.ts';
import type { CaseState } from '../../domain/workflow.ts';
import type { Db } from '../connection.ts';
import { nowIso } from '../connection.ts';

// Core repositories: users, risk models, cases, documents, pipeline runs/steps.

export type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  role_description: string;
  created_at: string;
};

export const users = {
  list(db: Db): UserRow[] {
    return db
      .prepare(
        'SELECT id, username, display_name, role, role_description, created_at FROM users ORDER BY created_at',
      )
      .all() as UserRow[];
  },
  byUsername(db: Db, username: string): UserRow | undefined {
    return db
      .prepare(
        'SELECT id, username, display_name, role, role_description, created_at FROM users WHERE username = ?',
      )
      .get(username) as UserRow | undefined;
  },
  byId(db: Db, id: string): UserRow | undefined {
    return db
      .prepare(
        'SELECT id, username, display_name, role, role_description, created_at FROM users WHERE id = ?',
      )
      .get(id) as UserRow | undefined;
  },
  insert(db: Db, u: Omit<UserRow, 'id' | 'created_at'> & { id?: string }): UserRow {
    const row: UserRow = { id: u.id ?? randomUUID(), created_at: nowIso(), ...u } as UserRow;
    db.prepare(
      'INSERT INTO users (id, username, display_name, role, role_description, password_hash, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?)',
    ).run(row.id, row.username, row.display_name, row.role, row.role_description, row.created_at);
    return row;
  },
};

export const riskModels = {
  active(db: Db): RiskModel {
    const row = db.prepare('SELECT model_json FROM risk_model_versions WHERE is_active = 1').get() as
      | { model_json: string }
      | undefined;
    if (!row) throw new Error('no active risk model');
    return parseRiskModel(JSON.parse(row.model_json));
  },
  byVersion(db: Db, version: string): RiskModel | undefined {
    const row = db.prepare('SELECT model_json FROM risk_model_versions WHERE version = ?').get(version) as
      | { model_json: string }
      | undefined;
    return row ? parseRiskModel(JSON.parse(row.model_json)) : undefined;
  },
  listVersions(
    db: Db,
  ): Array<{ version: string; is_active: number; published_at: string; notes: string | null }> {
    return db
      .prepare(
        'SELECT version, is_active, published_at, notes FROM risk_model_versions ORDER BY published_at',
      )
      .all() as never;
  },
  publish(db: Db, model: RiskModel, publishedBy: string | null, notes: string | null): void {
    db.prepare('UPDATE risk_model_versions SET is_active = 0 WHERE is_active = 1').run();
    db.prepare(
      'INSERT INTO risk_model_versions (version, model_json, is_active, published_by, published_at, notes) VALUES (?, ?, 1, ?, ?, ?)',
    ).run(model.version, JSON.stringify(model), publishedBy, nowIso(), notes);
  },
};

export type CaseRow = {
  id: string;
  ref: string;
  title: string;
  change_type: string;
  description: string;
  state: CaseState;
  submitted_by: string;
  created_at: string;
  updated_at: string;
};

export const cases = {
  nextRef(db: Db): string {
    const row = db
      .prepare("SELECT MAX(CAST(SUBSTR(ref, 4) AS INTEGER)) AS n FROM cases WHERE ref LIKE 'RA-%'")
      .get() as { n: number | null };
    return `RA-${(row.n ?? 1000) + 1}`;
  },
  insert(
    db: Db,
    c: { title: string; change_type: string; description: string; submitted_by: string; ref?: string },
  ): CaseRow {
    const now = nowIso();
    const row: CaseRow = {
      id: randomUUID(),
      ref: c.ref ?? cases.nextRef(db),
      title: c.title,
      change_type: c.change_type,
      description: c.description,
      state: 'SUBMITTED',
      submitted_by: c.submitted_by,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      'INSERT INTO cases (id, ref, title, change_type, description, state, submitted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.ref,
      row.title,
      row.change_type,
      row.description,
      row.state,
      row.submitted_by,
      row.created_at,
      row.updated_at,
    );
    return row;
  },
  byId(db: Db, id: string): CaseRow | undefined {
    return db.prepare('SELECT * FROM cases WHERE id = ?').get(id) as CaseRow | undefined;
  },
  byRef(db: Db, ref: string): CaseRow | undefined {
    return db.prepare('SELECT * FROM cases WHERE ref = ?').get(ref) as CaseRow | undefined;
  },
  list(db: Db): CaseRow[] {
    return db.prepare('SELECT * FROM cases ORDER BY created_at DESC').all() as CaseRow[];
  },
  setState(db: Db, id: string, state: CaseState): void {
    db.prepare('UPDATE cases SET state = ?, updated_at = ? WHERE id = ?').run(state, nowIso(), id);
  },
  touch(db: Db, id: string): void {
    db.prepare('UPDATE cases SET updated_at = ? WHERE id = ?').run(nowIso(), id);
  },
  freezeVersions(
    db: Db,
    caseId: string,
    v: {
      riskModelVersion: string;
      policyVersions: Record<string, string>;
      promptVersions: Record<string, string>;
      llmModels: Record<string, string>;
    },
  ): void {
    db.prepare(
      `INSERT OR IGNORE INTO case_versions (case_id, risk_model_version, policy_versions_json, prompt_versions_json, llm_models_json, frozen_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      caseId,
      v.riskModelVersion,
      JSON.stringify(v.policyVersions),
      JSON.stringify(v.promptVersions),
      JSON.stringify(v.llmModels),
      nowIso(),
    );
  },
  versions(
    db: Db,
    caseId: string,
  ):
    | {
        risk_model_version: string;
        policy_versions: Record<string, string>;
        prompt_versions: Record<string, string>;
        llm_models: Record<string, string>;
        frozen_at: string;
      }
    | undefined {
    const r = db.prepare('SELECT * FROM case_versions WHERE case_id = ?').get(caseId) as
      | {
          risk_model_version: string;
          policy_versions_json: string;
          prompt_versions_json: string;
          llm_models_json: string;
          frozen_at: string;
        }
      | undefined;
    if (!r) return undefined;
    return {
      risk_model_version: r.risk_model_version,
      policy_versions: JSON.parse(r.policy_versions_json),
      prompt_versions: JSON.parse(r.prompt_versions_json),
      llm_models: JSON.parse(r.llm_models_json),
      frozen_at: r.frozen_at,
    };
  },
};

export type DocumentRow = {
  id: string;
  case_id: string;
  kind: string;
  original_name: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  storage_path: string;
  parse_status: 'pending' | 'parsed' | 'parse_failed';
  parse_error: string | null;
  uploaded_by: string;
  uploaded_at: string;
};

export type ChunkRow = {
  id: string;
  document_id: string;
  chunk_ix: number;
  heading: string | null;
  page: number | null;
  text: string;
  char_count: number;
};
export type FlagRow = {
  id: string;
  document_id: string;
  chunk_ix: number;
  flag_type: string;
  matched_text: string;
  pattern: string;
  created_at: string;
};

export const documents = {
  insert(db: Db, d: Omit<DocumentRow, 'id' | 'parse_status' | 'parse_error' | 'uploaded_at'>): DocumentRow {
    const row: DocumentRow = {
      ...d,
      id: randomUUID(),
      parse_status: 'pending',
      parse_error: null,
      uploaded_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO documents (id, case_id, kind, original_name, mime, size_bytes, sha256, storage_path, parse_status, parse_error, uploaded_by, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
    ).run(
      row.id,
      row.case_id,
      row.kind,
      row.original_name,
      row.mime,
      row.size_bytes,
      row.sha256,
      row.storage_path,
      row.uploaded_by,
      row.uploaded_at,
    );
    return row;
  },
  forCase(db: Db, caseId: string): DocumentRow[] {
    return db
      .prepare('SELECT * FROM documents WHERE case_id = ? ORDER BY uploaded_at')
      .all(caseId) as DocumentRow[];
  },
  byId(db: Db, id: string): DocumentRow | undefined {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as DocumentRow | undefined;
  },
  setParsed(
    db: Db,
    id: string,
    chunks: Array<{ chunk_ix: number; heading: string | null; page: number | null; text: string }>,
  ): void {
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(id);
    const ins = db.prepare(
      'INSERT INTO document_chunks (id, document_id, chunk_ix, heading, page, text, char_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    for (const c of chunks) ins.run(randomUUID(), id, c.chunk_ix, c.heading, c.page, c.text, c.text.length);
    db.prepare("UPDATE documents SET parse_status = 'parsed', parse_error = NULL WHERE id = ?").run(id);
  },
  setParseFailed(db: Db, id: string, error: string): void {
    db.prepare("UPDATE documents SET parse_status = 'parse_failed', parse_error = ? WHERE id = ?").run(
      error.slice(0, 500),
      id,
    );
  },
  chunks(db: Db, documentId: string): ChunkRow[] {
    return db
      .prepare('SELECT * FROM document_chunks WHERE document_id = ? ORDER BY chunk_ix')
      .all(documentId) as ChunkRow[];
  },
  addFlag(
    db: Db,
    documentId: string,
    chunkIx: number,
    flagType: string,
    matchedText: string,
    pattern: string,
  ): void {
    db.prepare(
      'INSERT INTO document_flags (id, document_id, chunk_ix, flag_type, matched_text, pattern, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), documentId, chunkIx, flagType, matchedText, pattern, nowIso());
  },
  clearFlags(db: Db, documentId: string): void {
    db.prepare('DELETE FROM document_flags WHERE document_id = ?').run(documentId);
  },
  flagsForCase(db: Db, caseId: string): Array<FlagRow & { original_name: string }> {
    return db
      .prepare(
        `SELECT f.*, d.original_name FROM document_flags f JOIN documents d ON d.id = f.document_id WHERE d.case_id = ? ORDER BY f.created_at`,
      )
      .all(caseId) as never;
  },
};

export type StepName =
  | 'parse'
  | 'extract'
  | 'merge_contradict'
  | 'missing_info'
  | 'scope'
  | 'retrieve'
  | 'assess'
  | 'ground'
  | 'score'
  | 'packet';
export const STEP_ORDER: StepName[] = [
  'parse',
  'extract',
  'merge_contradict',
  'missing_info',
  'scope',
  'retrieve',
  'assess',
  'ground',
  'score',
  'packet',
];

export type RunRow = {
  id: string;
  case_id: string;
  mode: string;
  gateway: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  triggered_by: string;
};
export type StepRow = {
  id: string;
  run_id: string;
  step: StepName;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  attempt: number;
  error_code: string | null;
  error_message: string | null;
  summary_json: string | null;
  started_at: string | null;
  finished_at: string | null;
  latency_ms: number | null;
};

export const pipeline = {
  createRun(
    db: Db,
    caseId: string,
    gateway: 'anthropic' | 'mock',
    triggeredBy: string,
    mode: 'optimized' | 'baseline' = 'optimized',
  ): RunRow {
    const row: RunRow = {
      id: randomUUID(),
      case_id: caseId,
      mode,
      gateway,
      status: 'running',
      started_at: nowIso(),
      finished_at: null,
      triggered_by: triggeredBy,
    };
    db.prepare(
      'INSERT INTO pipeline_runs (id, case_id, mode, gateway, status, started_at, finished_at, triggered_by) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)',
    ).run(row.id, row.case_id, row.mode, row.gateway, row.status, row.started_at, row.triggered_by);
    const ins = db.prepare(
      "INSERT INTO pipeline_steps (id, run_id, step, status, attempt) VALUES (?, ?, ?, 'pending', 1)",
    );
    for (const s of STEP_ORDER) ins.run(randomUUID(), row.id, s);
    return row;
  },
  finishRun(db: Db, runId: string, status: 'succeeded' | 'failed' | 'manual_continue'): void {
    db.prepare('UPDATE pipeline_runs SET status = ?, finished_at = ? WHERE id = ?').run(
      status,
      nowIso(),
      runId,
    );
  },
  latestRun(db: Db, caseId: string): RunRow | undefined {
    return db
      .prepare('SELECT * FROM pipeline_runs WHERE case_id = ? ORDER BY started_at DESC LIMIT 1')
      .get(caseId) as RunRow | undefined;
  },
  steps(db: Db, runId: string): StepRow[] {
    const rows = db
      .prepare('SELECT * FROM pipeline_steps WHERE run_id = ? ORDER BY attempt')
      .all(runId) as StepRow[];
    return STEP_ORDER.map((s) => rows.filter((r) => r.step === s).at(-1)!).filter(Boolean);
  },
  step(db: Db, runId: string, step: StepName): StepRow {
    return db
      .prepare('SELECT * FROM pipeline_steps WHERE run_id = ? AND step = ? ORDER BY attempt DESC LIMIT 1')
      .get(runId, step) as StepRow;
  },
  startStep(db: Db, stepId: string): void {
    db.prepare("UPDATE pipeline_steps SET status = 'running', started_at = ? WHERE id = ?").run(
      nowIso(),
      stepId,
    );
  },
  finishStep(
    db: Db,
    stepId: string,
    status: 'succeeded' | 'failed' | 'skipped',
    summary: unknown,
    error?: { code: string; message: string },
  ): void {
    const started = (
      db.prepare('SELECT started_at FROM pipeline_steps WHERE id = ?').get(stepId) as {
        started_at: string | null;
      }
    ).started_at;
    const now = nowIso();
    const latency = started ? Date.parse(now) - Date.parse(started) : 0;
    db.prepare(
      'UPDATE pipeline_steps SET status = ?, summary_json = ?, error_code = ?, error_message = ?, finished_at = ?, latency_ms = ? WHERE id = ?',
    ).run(
      status,
      summary === undefined ? null : JSON.stringify(summary),
      error?.code ?? null,
      error?.message?.slice(0, 500) ?? null,
      now,
      latency,
      stepId,
    );
  },
};
