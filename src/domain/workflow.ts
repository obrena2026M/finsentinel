// Workflow state machine — FR-WF-01..09, Architecture §9.1. Pure, no I/O.

export const CASE_STATES = [
  'SUBMITTED',
  'ASSESSMENT',
  'ANALYST_REVIEW',
  'INFO_REQUESTED',
  'COMMITTEE_REVIEW',
  'DECIDED',
  'CLOSED',
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const DECISION_TYPES = ['APPROVE', 'APPROVE_WITH_CONDITIONS', 'DEFER', 'REJECT'] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

export const WORKFLOW_EVENTS = [
  'start_pipeline',
  'pipeline_done',
  'manual_continue',
  'request_info',
  'info_provided',
  'finalize',
  'approve',
  'approve_with_conditions',
  'reject',
  'defer',
  'close',
] as const;
export type WorkflowEvent = (typeof WORKFLOW_EVENTS)[number];

const TRANSITIONS: Record<CaseState, Partial<Record<WorkflowEvent, CaseState>>> = {
  SUBMITTED: { start_pipeline: 'ASSESSMENT' },
  ASSESSMENT: {
    pipeline_done: 'ANALYST_REVIEW',
    manual_continue: 'ANALYST_REVIEW',
    start_pipeline: 'ASSESSMENT',
  },
  ANALYST_REVIEW: {
    request_info: 'INFO_REQUESTED',
    finalize: 'COMMITTEE_REVIEW',
    start_pipeline: 'ASSESSMENT',
  },
  INFO_REQUESTED: { info_provided: 'ANALYST_REVIEW', start_pipeline: 'ASSESSMENT' },
  COMMITTEE_REVIEW: {
    approve: 'DECIDED',
    approve_with_conditions: 'DECIDED',
    reject: 'DECIDED',
    defer: 'ANALYST_REVIEW',
  },
  DECIDED: { close: 'CLOSED' },
  CLOSED: {},
};

export class WorkflowError extends Error {
  from: CaseState;
  event: WorkflowEvent;
  constructor(from: CaseState, event: WorkflowEvent, reason?: string) {
    super(reason ?? `invalid transition: ${event} from ${from}`);
    this.name = 'WorkflowError';
    this.from = from;
    this.event = event;
  }
}

export function canTransition(from: CaseState, event: WorkflowEvent): boolean {
  return TRANSITIONS[from][event] !== undefined;
}

export function transition(from: CaseState, event: WorkflowEvent): CaseState {
  const to = TRANSITIONS[from][event];
  if (!to) throw new WorkflowError(from, event);
  return to;
}

export function eventForDecision(type: DecisionType): WorkflowEvent {
  switch (type) {
    case 'APPROVE':
      return 'approve';
    case 'APPROVE_WITH_CONDITIONS':
      return 'approve_with_conditions';
    case 'REJECT':
      return 'reject';
    case 'DEFER':
      return 'defer';
  }
}

/** Blockers that must be empty before `finalize` (Architecture §9.1 guards). */
export type FinalizeGuardInput = {
  unsupportedClaims: number;
  openContradictions: number;
  openRequiredInfoRequests: number;
  unconfirmedLowConfidenceFacts: number;
  hasCurrentCalculation: boolean;
};

export function finalizeBlockers(g: FinalizeGuardInput): string[] {
  const b: string[] = [];
  if (g.unsupportedClaims > 0) b.push(`${g.unsupportedClaims} unsupported claim(s)`);
  if (g.openContradictions > 0) b.push(`${g.openContradictions} unresolved contradiction(s)`);
  if (g.openRequiredInfoRequests > 0) b.push(`${g.openRequiredInfoRequests} open information request(s)`);
  if (g.unconfirmedLowConfidenceFacts > 0)
    b.push(`${g.unconfirmedLowConfidenceFacts} unconfirmed low-confidence fact(s)`);
  if (!g.hasCurrentCalculation) b.push('no current risk calculation');
  return b;
}

export const MIN_RATIONALE_LENGTH = 20;

export function validateRationale(rationale: string | undefined | null): string {
  const r = (rationale ?? '').trim();
  if (r.length < MIN_RATIONALE_LENGTH) {
    throw new WorkflowError(
      'ANALYST_REVIEW',
      'finalize',
      `rationale is required (min ${MIN_RATIONALE_LENGTH} characters)`,
    );
  }
  return r;
}
