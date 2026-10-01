import type { Db } from '../db/connection.ts';
import type { DimensionKey, RiskModel } from '../domain/risk-model-schema.ts';
import type { MergedFact } from './merge.ts';

// Step 6 — deterministic policy retrieval over SQLite FTS5 (FR-RET-01..05, Architecture §6).

export type RetrievedChunk = {
  policy_chunk_id: string;
  policy_id: string;
  policy_version: string;
  section_ref: string;
  title: string | null;
  body: string;
  dimension: DimensionKey;
  score: number; // higher = more relevant
  query: string;
  rank: number;
};

const TOP_K_PER_DIMENSION = 4;
const MAX_PER_CASE = 16;

function tokens(v: unknown): string[] {
  const s = Array.isArray(v) ? v.join(' ') : String(v ?? '');
  return s
    .split(/[^A-Za-z0-9-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3 && !/^\d+$/.test(t));
}

export function buildQuery(model: RiskModel, dimension: DimensionKey, facts: MergedFact[]): string {
  const dim = model.dimensions.find((d) => d.key === dimension)!;
  const factTerms = facts
    .filter((f) => f.value !== null && dim.requiredFacts.includes(f.field))
    .flatMap((f) => tokens(f.value));
  const terms = Array.from(new Set([...dim.keywords.flatMap(tokens), ...factTerms])).slice(0, 24);
  // FTS5: quote every term; OR-join. Quoting also neutralises operators inside terms.
  return terms.map((t) => `"${t.replace(/"/g, '')}"`).join(' OR ');
}

export function retrieveEvidence(
  db: Db,
  model: RiskModel,
  dimensions: DimensionKey[],
  facts: MergedFact[],
): RetrievedChunk[] {
  const stmt = db.prepare(
    `SELECT pc.id AS policy_chunk_id, pc.policy_id, pc.policy_version, pc.section_ref, pc.title, pc.body,
            bm25(policy_chunks_fts) AS bm
     FROM policy_chunks_fts
     JOIN policy_chunks pc ON pc.rowid = policy_chunks_fts.rowid
     JOIN policy_versions pv ON pv.policy_id = pc.policy_id AND pv.version = pc.policy_version
     WHERE policy_chunks_fts MATCH ? AND pv.is_active = 1
     ORDER BY bm ASC
     LIMIT ?`,
  );
  const out: RetrievedChunk[] = [];
  const seen = new Set<string>();
  for (const dimension of dimensions) {
    const query = buildQuery(model, dimension, facts);
    if (!query) continue;
    const rows = stmt.all(query, TOP_K_PER_DIMENSION) as Array<
      Omit<RetrievedChunk, 'dimension' | 'score' | 'query' | 'rank'> & { bm: number }
    >;
    rows.forEach((r, i) => {
      const key = `${r.policy_chunk_id}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ ...r, dimension, score: Math.round(-r.bm * 10_000) / 10_000, query, rank: i + 1 });
    });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, MAX_PER_CASE);
}
