import type {
  AdversarialResult,
  AuditEvent,
  AuthUser,
  CaseListRow,
  CaseRow,
  CaseView,
  IntegrityReport,
  Me,
  Metrics,
  Packet,
  PipelineStatus,
  Quality,
  RiskModelAdmin,
  SampleSet,
} from './types.ts';

// Thin fetch wrapper over the Fastify API. Session cookie auth (credentials: 'include').
// A 401 sends the browser to /signin unless the caller opts out (used by the bootstrap /api/me probe).

export class ApiError extends Error {
  status: number;
  code: string;
  issues: string[] | undefined;
  constructor(status: number, code: string, message: string, issues?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

type RequestOptions = { redirectOn401?: boolean };

async function request<T>(
  method: string,
  url: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const init: RequestInit = { method, credentials: 'include', headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  const res = await fetch(url, init);
  if (res.status === 401 && opts.redirectOn401 !== false) {
    if (window.location.pathname !== '/signin') window.location.assign('/signin');
    throw new ApiError(401, 'unauthenticated', 'sign in first');
  }
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: 'invalid_response', message: text };
    }
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string; issues?: string[] };
    throw new ApiError(
      res.status,
      e.error ?? 'error',
      e.message ?? `${res.status} ${res.statusText}`,
      e.issues,
    );
  }
  return data as T;
}

export const get = <T>(url: string, opts?: RequestOptions) => request<T>('GET', url, undefined, opts);
export const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body);
export const patch = <T>(url: string, body?: unknown) => request<T>('PATCH', url, body);
export const put = <T>(url: string, body?: unknown) => request<T>('PUT', url, body);

// ---- Auth ----
export const api = {
  users: () => get<AuthUser[]>('/api/auth/users', { redirectOn401: false }),
  login: (username: string) => post<Me>('/api/auth/login', { username }),
  logout: () => post<{ ok: boolean }>('/api/auth/logout'),
  me: () => get<Me>('/api/me', { redirectOn401: false }),

  // ---- Cases ----
  listCases: () => get<CaseListRow[]>('/api/cases'),
  createCase: (body: { title: string; change_type: string; description: string }) =>
    post<CaseRow>('/api/cases', body),
  getCase: (id: string) => get<CaseView>(`/api/cases/${encodeURIComponent(id)}`),
  uploadDocument: (id: string, file: File, kind: string) => {
    const fd = new FormData();
    fd.append('kind', kind);
    fd.append('file', file, file.name);
    return post<{ id: string; original_name: string; mime: string; size_bytes: number }>(
      `/api/cases/${encodeURIComponent(id)}/documents`,
      fd,
    );
  },
  samples: () => get<SampleSet[]>('/api/samples'),
  attachSampleDocuments: (id: string, changeType: string) =>
    post<Array<{ id: string; original_name: string; mime: string; size_bytes: number }>>(
      `/api/cases/${encodeURIComponent(id)}/documents/from-sample`,
      { change_type: changeType },
    ),
  runPipeline: (id: string) => post<{ queued: boolean }>(`/api/cases/${encodeURIComponent(id)}/pipeline/run`),
  pipelineStatus: (id: string) => get<PipelineStatus>(`/api/cases/${encodeURIComponent(id)}/pipeline`),
  continueManually: (id: string, rationale: string) =>
    post<{ state: string }>(`/api/cases/${encodeURIComponent(id)}/pipeline/continue-manually`, { rationale }),

  confirmFact: (id: string, factId: string) =>
    patch<unknown>(`/api/cases/${encodeURIComponent(id)}/facts/${encodeURIComponent(factId)}/confirm`),
  enterFact: (id: string, body: { field: string; value: unknown; rationale: string }) =>
    post<unknown>(`/api/cases/${encodeURIComponent(id)}/facts`, body),
  resolveContradiction: (id: string, cid: string, body: { value: unknown; rationale: string }) =>
    post<unknown>(
      `/api/cases/${encodeURIComponent(id)}/contradictions/${encodeURIComponent(cid)}/resolve`,
      body,
    ),
  respondInfoRequest: (id: string, rid: string, answer: string) =>
    post<unknown>(
      `/api/cases/${encodeURIComponent(id)}/information-requests/${encodeURIComponent(rid)}/respond`,
      { answer },
    ),
  acceptGap: (id: string, rid: string, rationale: string) =>
    post<unknown>(
      `/api/cases/${encodeURIComponent(id)}/information-requests/${encodeURIComponent(rid)}/accept-gap`,
      { rationale },
    ),
  requestInfo: (id: string) => post<{ state: string }>(`/api/cases/${encodeURIComponent(id)}/request-info`),

  editAssessment: (id: string, summary: string) =>
    patch<unknown>(`/api/cases/${encodeURIComponent(id)}/assessment`, { summary }),
  removeClaim: (id: string, claimId: string, rationale: string) =>
    post<unknown>(`/api/cases/${encodeURIComponent(id)}/claims/${encodeURIComponent(claimId)}/remove`, {
      rationale,
    }),
  attachEvidence: (id: string, claimId: string, body: { evidence_ref_id: string; quote: string }) =>
    post<unknown>(
      `/api/cases/${encodeURIComponent(id)}/claims/${encodeURIComponent(claimId)}/evidence`,
      body,
    ),

  override: (id: string, body: { dimension: string; new_score: number; rationale: string }) =>
    post<unknown>(`/api/cases/${encodeURIComponent(id)}/overrides`, body),
  setControl: (id: string, dimension: string, body: { rating: string; rationale: string }) =>
    patch<unknown>(`/api/cases/${encodeURIComponent(id)}/controls/${encodeURIComponent(dimension)}`, body),

  finalize: (id: string) => post<{ state: string }>(`/api/cases/${encodeURIComponent(id)}/finalize`),
  decide: (id: string, body: { type: string; rationale: string; conditions?: Array<{ text: string }> }) =>
    post<unknown>(`/api/cases/${encodeURIComponent(id)}/decision`, body),
  close: (id: string) => post<{ state: string }>(`/api/cases/${encodeURIComponent(id)}/close`),

  packet: (id: string) => get<Packet>(`/api/cases/${encodeURIComponent(id)}/packet`),
  audit: (id: string) => get<AuditEvent[]>(`/api/cases/${encodeURIComponent(id)}/audit`),
  verifyAudit: (id: string) => get<IntegrityReport>(`/api/cases/${encodeURIComponent(id)}/audit/verify`),

  // ---- System ----
  quality: () => get<Quality>('/api/quality'),
  runAdversarial: (testId: string) =>
    post<AdversarialResult>(`/api/quality/adversarial/${encodeURIComponent(testId)}/run`),
  metrics: () => get<Metrics>('/api/metrics'),
  riskModel: () => get<RiskModelAdmin>('/api/admin/risk-model'),
  publishRiskModel: (model: unknown, notes: string) =>
    put<{ version: string }>('/api/admin/risk-model', { model, notes }),
};

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.issues?.length ? `${e.message}: ${e.issues.join('; ')}` : e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
