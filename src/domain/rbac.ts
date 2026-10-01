// Role-based access control — FR-RBAC-01..07, PRD §4.2. Matrix as data; routes never check roles inline.

export const ROLES = ['product_owner', 'analyst', 'committee', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export const ACTIONS = [
  'case.create',
  'case.view',
  'document.upload',
  'info_request.respond',
  'pipeline.run',
  'pipeline.manual_continue',
  'fact.confirm',
  'fact.enter',
  'contradiction.resolve',
  'info_request.accept_gap',
  'assessment.edit',
  'claim.remove',
  'claim.attach_evidence',
  'control.set',
  'override.create',
  'case.finalize',
  'decision.record',
  'packet.view',
  'audit.view',
  'risk_model.view',
  'risk_model.publish',
  'quality.view',
  'quality.run_adversarial',
  'metrics.view',
] as const;
export type Action = (typeof ACTIONS)[number];

const ALL: readonly Role[] = ROLES;

const MATRIX: Record<Action, readonly Role[]> = {
  'case.create': ['product_owner'],
  'case.view': ALL,
  'document.upload': ['product_owner'],
  'info_request.respond': ['product_owner'],
  'pipeline.run': ['product_owner', 'analyst'],
  'pipeline.manual_continue': ['analyst'],
  'fact.confirm': ['analyst'],
  'fact.enter': ['analyst'],
  'contradiction.resolve': ['analyst'],
  'info_request.accept_gap': ['analyst'],
  'assessment.edit': ['analyst'],
  'claim.remove': ['analyst'],
  'claim.attach_evidence': ['analyst'],
  'control.set': ['analyst'],
  'override.create': ['analyst'],
  'case.finalize': ['analyst'],
  'decision.record': ['committee'],
  'packet.view': ['analyst', 'committee'],
  'audit.view': ALL,
  'risk_model.view': ALL,
  'risk_model.publish': ['admin'],
  'quality.view': ALL,
  'quality.run_adversarial': ['analyst', 'admin'],
  'metrics.view': ALL,
};

export function isAllowed(role: Role, action: Action): boolean {
  return MATRIX[action].includes(role);
}

export function allowedRoles(action: Action): readonly Role[] {
  return MATRIX[action];
}

export const ROLE_LABELS: Record<Role, string> = {
  product_owner: 'Product Owner',
  analyst: 'FCRM Analyst',
  committee: 'Risk Committee',
  admin: 'FCRM Administrator',
};

export class AuthorizationError extends Error {
  role: Role;
  action: Action;
  constructor(role: Role, action: Action) {
    super(`role ${role} is not permitted to ${action}`);
    this.name = 'AuthorizationError';
    this.role = role;
    this.action = action;
  }
}
