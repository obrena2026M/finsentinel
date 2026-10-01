import { expect, test } from '@playwright/test';
import {
  canTransition,
  finalizeBlockers,
  transition,
  validateRationale,
  WorkflowError,
} from '../../src/domain/workflow.ts';

test.describe('workflow state machine (FR-WF)', () => {
  test('happy path SUBMITTED → … → CLOSED', () => {
    let s = transition('SUBMITTED', 'start_pipeline');
    expect(s).toBe('ASSESSMENT');
    s = transition(s, 'pipeline_done');
    expect(s).toBe('ANALYST_REVIEW');
    s = transition(s, 'finalize');
    expect(s).toBe('COMMITTEE_REVIEW');
    s = transition(s, 'approve_with_conditions');
    expect(s).toBe('DECIDED');
    s = transition(s, 'close');
    expect(s).toBe('CLOSED');
  });

  test('test_invalid_state_transition_rejected', () => {
    expect(() => transition('SUBMITTED', 'approve')).toThrow(WorkflowError);
    expect(() => transition('ANALYST_REVIEW', 'approve')).toThrow(WorkflowError);
    expect(() => transition('CLOSED', 'start_pipeline')).toThrow(WorkflowError);
    expect(canTransition('DECIDED', 'finalize')).toBe(false);
  });

  test('defer returns the case to ANALYST_REVIEW (TEST-020)', () => {
    expect(transition('COMMITTEE_REVIEW', 'defer')).toBe('ANALYST_REVIEW');
  });

  test('LLM failure path: manual_continue from ASSESSMENT', () => {
    expect(transition('ASSESSMENT', 'manual_continue')).toBe('ANALYST_REVIEW');
  });

  test('finalize blockers list every guard', () => {
    const b = finalizeBlockers({
      unsupportedClaims: 1,
      openContradictions: 2,
      openRequiredInfoRequests: 0,
      unconfirmedLowConfidenceFacts: 3,
      hasCurrentCalculation: false,
    });
    expect(b).toHaveLength(4);
    expect(
      finalizeBlockers({
        unsupportedClaims: 0,
        openContradictions: 0,
        openRequiredInfoRequests: 0,
        unconfirmedLowConfidenceFacts: 0,
        hasCurrentCalculation: true,
      }),
    ).toEqual([]);
  });

  test('test_override_requires_rationale (FR-OVR-02)', () => {
    expect(() => validateRationale('')).toThrow(/rationale is required/);
    expect(() => validateRationale('too short')).toThrow(WorkflowError);
    expect(validateRationale('  Comparable products have established monitoring coverage.  ')).toBe(
      'Comparable products have established monitoring coverage.',
    );
  });
});
