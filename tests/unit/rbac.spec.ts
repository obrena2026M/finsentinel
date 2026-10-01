import { expect, test } from '@playwright/test';
import { ACTIONS, isAllowed, ROLES } from '../../src/domain/rbac.ts';

test.describe('RBAC matrix (FR-RBAC)', () => {
  test('test_product_owner_cannot_approve (TEST-016)', () => {
    expect(isAllowed('product_owner', 'decision.record')).toBe(false);
    expect(isAllowed('product_owner', 'override.create')).toBe(false);
    expect(isAllowed('product_owner', 'risk_model.publish')).toBe(false);
    expect(isAllowed('product_owner', 'assessment.edit')).toBe(false);
  });

  test('test_analyst_cannot_make_committee_decision (TEST-017)', () => {
    expect(isAllowed('analyst', 'decision.record')).toBe(false);
    expect(isAllowed('analyst', 'override.create')).toBe(true);
    expect(isAllowed('analyst', 'case.finalize')).toBe(true);
  });

  test('test_committee_can_make_decision', () => {
    expect(isAllowed('committee', 'decision.record')).toBe(true);
    expect(isAllowed('committee', 'assessment.edit')).toBe(false);
  });

  test('only admin publishes risk model (FR-RBAC-06)', () => {
    for (const r of ROLES) expect(isAllowed(r, 'risk_model.publish')).toBe(r === 'admin');
  });

  test('exactly one role may record decisions', () => {
    const allowed = ROLES.filter((r) => isAllowed(r, 'decision.record'));
    expect(allowed).toEqual(['committee']);
  });

  test('every action has at least one permitted role', () => {
    for (const a of ACTIONS)
      expect(
        ROLES.some((r) => isAllowed(r, a)),
        a,
      ).toBe(true);
  });
});
