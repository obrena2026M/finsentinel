import type { Role } from './types.ts';

// UI visibility matrix — mirrors src/domain/rbac.ts (server is authoritative; this only hides
// affordances the role cannot use, per UX §7: forbidden actions are absent, not greyed).

export type UiAction =
  | 'case.create'
  | 'document.upload'
  | 'info_request.respond'
  | 'pipeline.run'
  | 'pipeline.manual_continue'
  | 'fact.confirm'
  | 'fact.enter'
  | 'contradiction.resolve'
  | 'info_request.accept_gap'
  | 'assessment.edit'
  | 'claim.remove'
  | 'claim.attach_evidence'
  | 'control.set'
  | 'override.create'
  | 'case.finalize'
  | 'decision.record'
  | 'packet.view'
  | 'risk_model.publish'
  | 'quality.run_adversarial';

const MATRIX: Record<UiAction, readonly Role[]> = {
  'case.create': ['product_owner'],
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
  'risk_model.publish': ['admin'],
  'quality.run_adversarial': ['analyst', 'admin'],
};

export function can(role: Role | null | undefined, action: UiAction): boolean {
  if (!role) return false;
  return MATRIX[action].includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  product_owner: 'Product Owner',
  analyst: 'FCRM Analyst',
  committee: 'Risk Committee',
  admin: 'FCRM Administrator',
};
