import { randomUUID } from 'node:crypto';
import type { RiskCalculation } from '../../domain/risk-engine.ts';
import type { ControlRatingOrUnverified, DimensionKey } from '../../domain/risk-model-schema.ts';
import type { Db } from '../connection.ts';
import { nowIso } from '../connection.ts';

// Facts, contradictions, information requests, evidence, assessments, claims, scores, overrides, calculations.

export type FactRow = {
  id: string;
  case_id: string;
  field: string;
  value_json: string | null;
  confidence: number | null;
  status:
    | 'extracted'
    | 'low_confidence'
    | 'confirmed'
    | 'missing'
    | 'conflicted'
    | 'resolved'
    | 'analyst_entered';
  missing_reason: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
};
export type FactSourceRow = {
  id: string;
  fact_id: string;
  document_id: string;
  chunk_ix: number;
  quote: string;
};

export const facts = {
  replaceAll(
    db: Db,
    caseId: string,
    list: Array<{
      field: string;
      value: unknown;
      confidence: number;
      status: FactRow['status'];
      missing_reason: string | null;
      sources: Array<{ doc_id: string; chunk_ix: number; quote: string }>;
    }>,
  ): void {
    db.prepare('DELETE FROM fact_sources WHERE fact_id IN (SELECT id FROM facts WHERE case_id = ?)').run(
      caseId,
    );
    db.prepare('DELETE FROM facts WHERE case_id = ?').run(caseId);
    const insF = db.prepare(
      'INSERT INTO facts (id, case_id, field, value_json, confidence, status, missing_reason) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const insS = db.prepare(
      'INSERT INTO fact_sources (id, fact_id, document_id, chunk_ix, quote) VALUES (?, ?, ?, ?, ?)',
    );
    for (const f of list) {
      const id = randomUUID();
      insF.run(
        id,
        caseId,
        f.field,
        f.value === null ? null : JSON.stringify(f.value),
        f.confidence,
        f.status,
        f.missing_reason,
      );
      for (const s of f.sources) insS.run(randomUUID(), id, s.doc_id, s.chunk_ix, s.quote.slice(0, 300));
    }
  },
  forCase(db: Db, caseId: string): Array<FactRow & { sources: FactSourceRow[] }> {
    const rows = db.prepare('SELECT * FROM facts WHERE case_id = ? ORDER BY field').all(caseId) as FactRow[];
    const srcs = db
      .prepare('SELECT s.* FROM fact_sources s JOIN facts f ON f.id = s.fact_id WHERE f.case_id = ?')
      .all(caseId) as FactSourceRow[];
    return rows.map((r) => ({ ...r, sources: srcs.filter((s) => s.fact_id === r.id) }));
  },
  byId(db: Db, id: string): FactRow | undefined {
    return db.prepare('SELECT * FROM facts WHERE id = ?').get(id) as FactRow | undefined;
  },
  confirm(db: Db, id: string, userId: string): void {
    db.prepare("UPDATE facts SET status = 'confirmed', confirmed_by = ?, confirmed_at = ? WHERE id = ?").run(
      userId,
      nowIso(),
      id,
    );
  },
  setValue(db: Db, id: string, value: unknown, status: FactRow['status'], userId: string): void {
    db.prepare(
      'UPDATE facts SET value_json = ?, status = ?, confidence = 1, missing_reason = NULL, confirmed_by = ?, confirmed_at = ? WHERE id = ?',
    ).run(JSON.stringify(value), status, userId, nowIso(), id);
  },
  upsertAnalystValue(db: Db, caseId: string, field: string, value: unknown, userId: string): FactRow {
    const existing = db.prepare('SELECT * FROM facts WHERE case_id = ? AND field = ?').get(caseId, field) as
      | FactRow
      | undefined;
    if (existing) {
      facts.setValue(db, existing.id, value, 'analyst_entered', userId);
      return facts.byId(db, existing.id)!;
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO facts (id, case_id, field, value_json, confidence, status, missing_reason, confirmed_by, confirmed_at) VALUES (?, ?, ?, ?, 1, 'analyst_entered', NULL, ?, ?)",
    ).run(id, caseId, field, JSON.stringify(value), userId, nowIso());
    return facts.byId(db, id)!;
  },
};

export type ContradictionRow = {
  id: string;
  case_id: string;
  field: string;
  candidates_json: string;
  detected_by: 'rule' | 'llm';
  status: 'open' | 'resolved';
  resolved_value_json: string | null;
  rationale: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
};

export const contradictions = {
  replaceOpen(
    db: Db,
    caseId: string,
    list: Array<{ field: string; candidates: unknown; detected_by: 'rule' | 'llm' }>,
  ): void {
    db.prepare("DELETE FROM contradictions WHERE case_id = ? AND status = 'open'").run(caseId);
    const ins = db.prepare(
      "INSERT INTO contradictions (id, case_id, field, candidates_json, detected_by, status) VALUES (?, ?, ?, ?, ?, 'open')",
    );
    for (const c of list) ins.run(randomUUID(), caseId, c.field, JSON.stringify(c.candidates), c.detected_by);
  },
  forCase(db: Db, caseId: string): ContradictionRow[] {
    return db
      .prepare('SELECT * FROM contradictions WHERE case_id = ? ORDER BY status DESC, field')
      .all(caseId) as ContradictionRow[];
  },
  byId(db: Db, id: string): ContradictionRow | undefined {
    return db.prepare('SELECT * FROM contradictions WHERE id = ?').get(id) as ContradictionRow | undefined;
  },
  resolve(db: Db, id: string, value: unknown, rationale: string, userId: string): void {
    db.prepare(
      "UPDATE contradictions SET status = 'resolved', resolved_value_json = ?, rationale = ?, resolved_by = ?, resolved_at = ? WHERE id = ?",
    ).run(JSON.stringify(value), rationale, userId, nowIso(), id);
  },
  openCount(db: Db, caseId: string): number {
    return (
      db
        .prepare("SELECT COUNT(*) n FROM contradictions WHERE case_id = ? AND status = 'open'")
        .get(caseId) as { n: number }
    ).n;
  },
};

export type InfoRequestRow = {
  id: string;
  case_id: string;
  field: string;
  question: string;
  status: 'open' | 'answered' | 'gap_accepted';
  answer: string | null;
  answered_by: string | null;
  answered_at: string | null;
  accepted_rationale: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
};

export const infoRequests = {
  replaceOpen(db: Db, caseId: string, list: Array<{ field: string; question: string }>): void {
    // Keep answered/accepted ones; refresh open ones.
    db.prepare("DELETE FROM information_requests WHERE case_id = ? AND status = 'open'").run(caseId);
    const closed = new Set(
      (
        db
          .prepare("SELECT field FROM information_requests WHERE case_id = ? AND status <> 'open'")
          .all(caseId) as Array<{ field: string }>
      ).map((r) => r.field),
    );
    const ins = db.prepare(
      "INSERT INTO information_requests (id, case_id, field, question, status) VALUES (?, ?, ?, ?, 'open')",
    );
    for (const r of list) if (!closed.has(r.field)) ins.run(randomUUID(), caseId, r.field, r.question);
  },
  forCase(db: Db, caseId: string): InfoRequestRow[] {
    return db
      .prepare('SELECT * FROM information_requests WHERE case_id = ? ORDER BY status, field')
      .all(caseId) as InfoRequestRow[];
  },
  byId(db: Db, id: string): InfoRequestRow | undefined {
    return db.prepare('SELECT * FROM information_requests WHERE id = ?').get(id) as
      | InfoRequestRow
      | undefined;
  },
  answer(db: Db, id: string, answer: string, userId: string): void {
    db.prepare(
      "UPDATE information_requests SET status = 'answered', answer = ?, answered_by = ?, answered_at = ? WHERE id = ?",
    ).run(answer, userId, nowIso(), id);
  },
  acceptGap(db: Db, id: string, rationale: string, userId: string): void {
    db.prepare(
      "UPDATE information_requests SET status = 'gap_accepted', accepted_rationale = ?, accepted_by = ?, accepted_at = ? WHERE id = ?",
    ).run(rationale, userId, nowIso(), id);
  },
  openCount(db: Db, caseId: string): number {
    return (
      db
        .prepare("SELECT COUNT(*) n FROM information_requests WHERE case_id = ? AND status = 'open'")
        .get(caseId) as { n: number }
    ).n;
  },
};

export type EvidenceRow = {
  id: string;
  case_id: string;
  policy_chunk_id: string;
  dimension: string;
  bm25_score: number;
  query: string;
  rank: number;
  policy_id: string;
  policy_version: string;
  section_ref: string;
  title: string | null;
  body: string;
};

export const evidence = {
  replaceAll(
    db: Db,
    caseId: string,
    list: Array<{ policy_chunk_id: string; dimension: string; score: number; query: string; rank: number }>,
  ): string[] {
    db.prepare(
      'DELETE FROM claim_evidence WHERE evidence_ref_id IN (SELECT id FROM evidence_refs WHERE case_id = ?)',
    ).run(caseId);
    db.prepare('DELETE FROM evidence_refs WHERE case_id = ?').run(caseId);
    const ins = db.prepare(
      'INSERT INTO evidence_refs (id, case_id, policy_chunk_id, dimension, bm25_score, query, rank) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const ids: string[] = [];
    for (const e of list) {
      const id = randomUUID();
      ins.run(id, caseId, e.policy_chunk_id, e.dimension, e.score, e.query, e.rank);
      ids.push(id);
    }
    return ids;
  },
  forCase(db: Db, caseId: string): EvidenceRow[] {
    return db
      .prepare(
        `SELECT e.*, pc.policy_id, pc.policy_version, pc.section_ref, pc.title, pc.body
         FROM evidence_refs e JOIN policy_chunks pc ON pc.id = e.policy_chunk_id WHERE e.case_id = ? ORDER BY e.bm25_score DESC`,
      )
      .all(caseId) as EvidenceRow[];
  },
  byId(db: Db, id: string): EvidenceRow | undefined {
    return db
      .prepare(
        `SELECT e.*, pc.policy_id, pc.policy_version, pc.section_ref, pc.title, pc.body FROM evidence_refs e JOIN policy_chunks pc ON pc.id = e.policy_chunk_id WHERE e.id = ?`,
      )
      .get(id) as EvidenceRow | undefined;
  },
};

export type AssessmentRow = {
  id: string;
  case_id: string;
  run_id: string | null;
  is_current: number;
  summary: string;
  dimension_narratives_json: string;
  model: string | null;
  prompt_version: string | null;
  created_at: string;
};
export type ClaimRow = {
  id: string;
  assessment_id: string;
  dimension: string;
  text: string;
  verdict: 'SUPPORTED' | 'UNSUPPORTED' | 'WEAK';
  verdict_reason: string | null;
  status: 'active' | 'removed';
};
export type ClaimEvidenceRow = {
  claim_id: string;
  evidence_ref_id: string;
  quote: string;
  quote_verified: number;
  added_by: 'ai' | 'analyst';
};

export const assessments = {
  createCurrent(
    db: Db,
    a: {
      case_id: string;
      run_id: string | null;
      summary: string;
      narratives: Record<string, string>;
      model: string | null;
      prompt_version: string | null;
    },
  ): AssessmentRow {
    db.prepare('UPDATE assessments SET is_current = 0 WHERE case_id = ? AND is_current = 1').run(a.case_id);
    const row: AssessmentRow = {
      id: randomUUID(),
      case_id: a.case_id,
      run_id: a.run_id,
      is_current: 1,
      summary: a.summary,
      dimension_narratives_json: JSON.stringify(a.narratives),
      model: a.model,
      prompt_version: a.prompt_version,
      created_at: nowIso(),
    };
    db.prepare(
      'INSERT INTO assessments (id, case_id, run_id, is_current, summary, dimension_narratives_json, model, prompt_version, created_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.case_id,
      row.run_id,
      row.summary,
      row.dimension_narratives_json,
      row.model,
      row.prompt_version,
      row.created_at,
    );
    return row;
  },
  current(db: Db, caseId: string): AssessmentRow | undefined {
    return db.prepare('SELECT * FROM assessments WHERE case_id = ? AND is_current = 1').get(caseId) as
      | AssessmentRow
      | undefined;
  },
  updateSummary(db: Db, id: string, summary: string): void {
    db.prepare('UPDATE assessments SET summary = ? WHERE id = ?').run(summary, id);
  },
  addClaim(
    db: Db,
    c: {
      assessment_id: string;
      dimension: string;
      text: string;
      verdict: ClaimRow['verdict'];
      verdict_reason: string | null;
      citations: Array<{
        evidence_ref_id: string;
        quote: string;
        verified: boolean;
        added_by: 'ai' | 'analyst';
      }>;
    },
  ): ClaimRow {
    const row: ClaimRow = {
      id: randomUUID(),
      assessment_id: c.assessment_id,
      dimension: c.dimension,
      text: c.text,
      verdict: c.verdict,
      verdict_reason: c.verdict_reason,
      status: 'active',
    };
    db.prepare(
      "INSERT INTO claims (id, assessment_id, dimension, text, verdict, verdict_reason, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
    ).run(row.id, row.assessment_id, row.dimension, row.text, row.verdict, row.verdict_reason);
    const ins = db.prepare(
      'INSERT OR IGNORE INTO claim_evidence (claim_id, evidence_ref_id, quote, quote_verified, added_by) VALUES (?, ?, ?, ?, ?)',
    );
    for (const ce of c.citations)
      ins.run(row.id, ce.evidence_ref_id, ce.quote, ce.verified ? 1 : 0, ce.added_by);
    return row;
  },
  claims(
    db: Db,
    assessmentId: string,
  ): Array<ClaimRow & { evidence: Array<ClaimEvidenceRow & { section_ref: string; policy_id: string }> }> {
    const rows = db
      .prepare('SELECT * FROM claims WHERE assessment_id = ? ORDER BY dimension, rowid')
      .all(assessmentId) as ClaimRow[];
    const ce = db
      .prepare(
        `SELECT ce.*, pc.section_ref, pc.policy_id FROM claim_evidence ce
         JOIN evidence_refs e ON e.id = ce.evidence_ref_id JOIN policy_chunks pc ON pc.id = e.policy_chunk_id
         WHERE ce.claim_id IN (SELECT id FROM claims WHERE assessment_id = ?)`,
      )
      .all(assessmentId) as Array<ClaimEvidenceRow & { section_ref: string; policy_id: string }>;
    return rows.map((r) => ({ ...r, evidence: ce.filter((x) => x.claim_id === r.id) }));
  },
  claimById(db: Db, id: string): ClaimRow | undefined {
    return db.prepare('SELECT * FROM claims WHERE id = ?').get(id) as ClaimRow | undefined;
  },
  removeClaim(db: Db, id: string): void {
    db.prepare("UPDATE claims SET status = 'removed' WHERE id = ?").run(id);
  },
  setClaimVerdict(db: Db, id: string, verdict: ClaimRow['verdict'], reason: string): void {
    db.prepare('UPDATE claims SET verdict = ?, verdict_reason = ? WHERE id = ?').run(verdict, reason, id);
  },
  attachEvidence(db: Db, claimId: string, evidenceRefId: string, quote: string, verified: boolean): void {
    db.prepare(
      "INSERT OR REPLACE INTO claim_evidence (claim_id, evidence_ref_id, quote, quote_verified, added_by) VALUES (?, ?, ?, ?, 'analyst')",
    ).run(claimId, evidenceRefId, quote, verified ? 1 : 0);
  },
  unsupportedCount(db: Db, caseId: string): number {
    return (
      db
        .prepare(
          `SELECT COUNT(*) n FROM claims c JOIN assessments a ON a.id = c.assessment_id
           WHERE a.case_id = ? AND a.is_current = 1 AND c.status = 'active' AND c.verdict = 'UNSUPPORTED'`,
        )
        .get(caseId) as { n: number }
    ).n;
  },
};

export type DimensionScoreRow = {
  case_id: string;
  dimension: DimensionKey;
  ai_recommended: number | null;
  current_score: number | null;
  control_rating: ControlRatingOrUnverified;
  control_rationale: string | null;
  control_set_by: string | null;
  control_set_at: string | null;
};

export const scores = {
  upsertAi(db: Db, caseId: string, dimension: string, aiScore: number): void {
    db.prepare(
      `INSERT INTO dimension_scores (case_id, dimension, ai_recommended, current_score) VALUES (?, ?, ?, ?)
       ON CONFLICT(case_id, dimension) DO UPDATE SET ai_recommended = excluded.ai_recommended,
         current_score = COALESCE((SELECT current_score FROM dimension_scores WHERE case_id = excluded.case_id AND dimension = excluded.dimension), excluded.current_score)`,
    ).run(caseId, dimension, aiScore, aiScore);
  },
  forCase(db: Db, caseId: string): DimensionScoreRow[] {
    return db.prepare('SELECT * FROM dimension_scores WHERE case_id = ?').all(caseId) as DimensionScoreRow[];
  },
  setCurrent(db: Db, caseId: string, dimension: string, score: number): void {
    db.prepare('UPDATE dimension_scores SET current_score = ? WHERE case_id = ? AND dimension = ?').run(
      score,
      caseId,
      dimension,
    );
  },
  setControl(
    db: Db,
    caseId: string,
    dimension: string,
    rating: ControlRatingOrUnverified,
    rationale: string,
    userId: string,
  ): void {
    db.prepare(
      'UPDATE dimension_scores SET control_rating = ?, control_rationale = ?, control_set_by = ?, control_set_at = ? WHERE case_id = ? AND dimension = ?',
    ).run(rating, rationale, userId, nowIso(), caseId, dimension);
  },
};

export type OverrideRow = {
  id: string;
  case_id: string;
  dimension: string;
  previous_score: number;
  new_score: number;
  rationale: string;
  user_id: string;
  user_role: string;
  risk_model_version: string;
  created_at: string;
};

export const overrides = {
  insert(db: Db, o: Omit<OverrideRow, 'id' | 'created_at'>): OverrideRow {
    const row: OverrideRow = { ...o, id: randomUUID(), created_at: nowIso() };
    db.prepare(
      'INSERT INTO overrides (id, case_id, dimension, previous_score, new_score, rationale, user_id, user_role, risk_model_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.case_id,
      row.dimension,
      row.previous_score,
      row.new_score,
      row.rationale,
      row.user_id,
      row.user_role,
      row.risk_model_version,
      row.created_at,
    );
    return row;
  },
  forCase(db: Db, caseId: string): OverrideRow[] {
    return db
      .prepare('SELECT * FROM overrides WHERE case_id = ? ORDER BY created_at')
      .all(caseId) as OverrideRow[];
  },
};

export type CalculationRow = {
  id: string;
  case_id: string;
  risk_model_version: string;
  trigger: string;
  inputs_json: string;
  by_dimension_json: string;
  inherent_score: number;
  residual_score: number;
  inherent_band: string;
  residual_band: string;
  is_current: number;
  computed_at: string;
};

export const calculations = {
  insertCurrent(
    db: Db,
    caseId: string,
    trigger: string,
    inputs: unknown,
    calc: RiskCalculation,
  ): CalculationRow {
    db.prepare('UPDATE risk_calculations SET is_current = 0 WHERE case_id = ? AND is_current = 1').run(
      caseId,
    );
    const row: CalculationRow = {
      id: randomUUID(),
      case_id: caseId,
      risk_model_version: calc.riskModelVersion,
      trigger,
      inputs_json: JSON.stringify(inputs),
      by_dimension_json: JSON.stringify(calc.byDimension),
      inherent_score: calc.inherentScore,
      residual_score: calc.residualScore,
      inherent_band: calc.inherentBand,
      residual_band: calc.residualBand,
      is_current: 1,
      computed_at: nowIso(),
    };
    db.prepare(
      `INSERT INTO risk_calculations (id, case_id, risk_model_version, trigger, inputs_json, by_dimension_json, inherent_score, residual_score, inherent_band, residual_band, is_current, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      row.id,
      row.case_id,
      row.risk_model_version,
      row.trigger,
      row.inputs_json,
      row.by_dimension_json,
      row.inherent_score,
      row.residual_score,
      row.inherent_band,
      row.residual_band,
      row.computed_at,
    );
    return row;
  },
  current(db: Db, caseId: string): CalculationRow | undefined {
    return db.prepare('SELECT * FROM risk_calculations WHERE case_id = ? AND is_current = 1').get(caseId) as
      | CalculationRow
      | undefined;
  },
  history(db: Db, caseId: string): CalculationRow[] {
    return db
      .prepare('SELECT * FROM risk_calculations WHERE case_id = ? ORDER BY computed_at')
      .all(caseId) as CalculationRow[];
  },
};
