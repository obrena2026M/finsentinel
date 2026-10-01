import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, type Locator, type Page, test } from '@playwright/test';

// STAGE04 user-manual capture. Performs the complete workflow per role through the real UI and
// saves the screenshots referenced by documents/STAGE04_User_Manual.md. Runs serially on one fresh
// in-memory server (playwright.manual.config.ts) so every screenshot shows a known state.
//
// Journey (UX §3, §8; FR-WF-01..09):
//   Product Owner  creates a case from sample documents and watches the AI review
//   FCRM Analyst   clears the RA-1001 blockers, requests information, sets a control, overrides, finalizes
//   Product Owner  answers the information request
//   Risk Committee approves with conditions and closes the case
//   FCRM Admin     Quality Center, live adversarial test, Ops, risk model publish

test.describe.configure({ mode: 'serial' });

const ROOT = process.cwd();
const SHOTS = join(ROOT, 'documents', 'manual', 'screenshots');
const DIAGRAMS = join(ROOT, 'documents', 'manual', 'diagrams');
mkdirSync(SHOTS, { recursive: true });

const RATIONALE = {
  resolve:
    'Product proposal is the later, signed-off source; Brazil was removed from launch scope in the vendor questionnaire.',
  removeClaim:
    'No policy evidence supports the vendor sanctions-control claim; removed pending vendor attestation.',
  control: 'Vendor questionnaire section 4 confirms real-time sanctions screening on all outbound payments.',
  override:
    'Comparable existing products have established monitoring coverage and similar geographic exposure.',
  decision:
    'Residual risk is Moderate after analyst review. Approve subject to sanctions screening evidence before launch.',
  acceptGap:
    'Owner confirmed the figure is a forecast; treated as indicative and revisited at the 90-day review.',
};

let newCasePath = '';
let newCaseRef = '';

async function signIn(page: Page, username: string) {
  await page.goto('/signin');
  await page.getByTestId(`tile-${username}`).click();
  await page.waitForURL(/\/cases/);
  await page.getByTestId('role-badge').waitFor();
}

async function shot(target: Page | Locator, name: string, opts: { fullPage?: boolean } = {}) {
  const path = join(SHOTS, `${name}.png`);
  if ('goto' in target) {
    // Let polling/animations settle before capturing.
    await target.waitForTimeout(400);
    await target.screenshot({ path, fullPage: opts.fullPage ?? false });
  } else {
    await target.screenshot({ path });
  }
}

async function openCase(page: Page, ref: string, tab?: string) {
  await page.goto('/cases');
  await page.getByTestId(`case-row-${ref}`).click();
  await page.waitForURL(/\/cases\/[^/]+/);
  if (tab) {
    await page.getByTestId(`tab-${tab}`).click();
    await page.waitForURL(new RegExp(`#${tab}`));
  }
}

async function waitToast(page: Page) {
  await expect(page.getByText(/Recorded in history|published/i).first()).toBeVisible({ timeout: 15_000 });
}

async function fillRationale(page: Page, text: string) {
  const dialog = page.getByRole('dialog');
  const input = dialog.getByTestId('rationale-input');
  if (await input.count()) await input.fill(text);
}

async function resolveRemainingContradictions(page: Page) {
  const buttons = page.locator('[data-testid^="resolve-"]');
  while ((await buttons.count()) > 0) {
    await buttons.first().click();
    await fillRationale(page, RATIONALE.resolve);
    await page.getByTestId('dialog-submit').click();
    await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
    await page.waitForTimeout(500);
  }
}

// ---------------------------------------------------------------------------------------------
test('00 sign-in: role tiles, light and dark theme', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByTestId('tile-owner.pat')).toBeVisible();
  await shot(page, '00-signin-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.getByTestId('tile-owner.pat').click();
  await page.waitForURL(/\/cases/);
  // Theme toggle persists across reloads (UX §4.1a).
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByTestId('theme-toggle').click();
  await expect(html).not.toHaveAttribute('data-theme', before ?? '');
  await shot(page, '01-cases-dark-theme');
  await page.getByTestId('theme-toggle').click();
});

// ---------------------------------------------------------------------------------------------
test('10 product owner: case list, new case from sample documents, AI review', async ({ page }) => {
  await signIn(page, 'owner.pat');
  await expect(page.getByTestId('new-case-btn')).toBeVisible();
  await shot(page, '10-owner-case-list');

  await page.getByTestId('new-case-btn').click();
  await page.waitForURL(/\/cases\/new/);
  await shot(page, '11-owner-new-case-empty');

  await page.getByTestId('case-change-type').selectOption('vendor');
  await expect(page.getByTestId('sample-card')).toBeVisible();
  await page.getByTestId('use-sample-btn').click();
  await expect(page.getByTestId('sample-selected')).toBeVisible();
  await expect(page.getByTestId('create-case-btn')).toBeEnabled();
  await shot(page, '12-owner-new-case-filled-from-sample', { fullPage: true });

  await page.getByTestId('create-case-btn').click();
  const modal = page.getByTestId('ai-review-modal');
  await expect(modal).toBeVisible({ timeout: 30_000 });
  await page.waitForURL(/\/cases\/[^/]+#overview/);
  newCasePath = new URL(page.url()).pathname;
  await expect(page.getByTestId('ai-review-step-extract')).toHaveAttribute('data-status', /checking|done/, {
    timeout: 20_000,
  });
  await shot(page, '13-owner-ai-review-in-progress');
  await expect(page.getByTestId('ai-review-step-packet')).toHaveAttribute('data-status', 'done', {
    timeout: 90_000,
  });
  await expect(modal.getByRole('heading')).toContainText(/AI Review complete/);
  await shot(page, '14-owner-ai-review-complete');
  await page.getByTestId('ai-review-open-case').click();
  await expect(page.getByTestId('pipeline-step-packet')).toContainText(/succeeded/i, { timeout: 30_000 });
  newCaseRef = (await page.locator('h1').first().innerText()).trim().split(/\s+/)[0] ?? '';
  await shot(page, '15-owner-new-case-overview', { fullPage: true });

  // The owner sees the packet notice but never sees decision controls (UX §7).
  await page.getByTestId('tab-committee').click();
  await expect(page.getByTestId('decision-block')).toHaveCount(0);
  await shot(page, '16-owner-committee-tab-read-only');
});

// ---------------------------------------------------------------------------------------------
test('20 analyst: read blockers, confirm fact, resolve contradiction, request information', async ({
  page,
}) => {
  await signIn(page, 'analyst.kim');
  await openCase(page, 'RA-1001');
  await expect(page.getByTestId('pipeline-step-assess')).toContainText(/succeeded/i);
  await expect(page.getByTestId('blocker-item').first()).toBeVisible();
  await expect(page.getByTestId('finalize-btn')).toBeDisabled();
  await shot(page, '20-analyst-overview-blockers', { fullPage: true });

  await page.getByTestId('tab-facts').click();
  await expect(page.getByTestId('fact-row-transaction_velocity')).toBeVisible();
  await shot(page, '21-analyst-facts-tab', { fullPage: true });

  // Low-confidence fact → confirm (FR-EX-05).
  await page.getByTestId('confirm-fact-transaction_velocity').click();
  await waitToast(page);

  // Contradictions → resolve each with a rationale (FR-EX-07). The geography one is shown in the manual.
  await page.getByTestId('resolve-geographies').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await fillRationale(page, RATIONALE.resolve);
  await shot(page, '22-analyst-resolve-contradiction-dialog');
  await page.getByTestId('dialog-submit').click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  await resolveRemainingContradictions(page);

  // Open information request → send to owner (FR-WF-04).
  await expect(page.getByTestId('info-request-transaction_volume')).toBeVisible();
  await page.getByTestId('request-info-btn').click();
  await expect(page.getByText(/INFO[ _]REQUESTED/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '23-analyst-info-requested', { fullPage: true });
});

// ---------------------------------------------------------------------------------------------
test('30 product owner: answer the information request', async ({ page }) => {
  await signIn(page, 'owner.pat');
  await openCase(page, 'RA-1001', 'facts');
  const inputs = page.locator('[data-testid^="answer-input-"]');
  await expect(inputs.first()).toBeVisible();
  await inputs
    .first()
    .fill('Approximately 12,000 outbound payments per month at launch, forecast 30,000 by month 12.');
  await shot(page, '30-owner-answer-information-request', { fullPage: true });
  // Answer every open request so the case returns to Analyst review.
  const n = await inputs.count();
  for (let i = 0; i < n; i++) {
    const input = inputs.nth(0);
    if (!(await input.isVisible())) break;
    if (!(await input.inputValue()))
      await input.fill('Provided by the product owner during information request follow-up.');
    const field = (await input.getAttribute('data-testid'))?.replace('answer-input-', '') ?? '';
    await page.getByTestId(`answer-btn-${field}`).click();
    await waitToast(page);
    await page.waitForTimeout(800);
  }
  await expect(page.getByText(/ANALYST[ _]REVIEW/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '31-owner-request-answered', { fullPage: true });
});

// ---------------------------------------------------------------------------------------------
test('40 analyst: evidence, claims, controls, override, history, finalize', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  await openCase(page, 'RA-1001', 'evidence');
  await expect(page.locator('[data-testid^="evidence-"]').first()).toBeVisible();
  await shot(page, '40-analyst-evidence-tab', { fullPage: true });

  // Assessment: claims with verdicts. Show the attach-evidence dialog, then remove the unsupported claim.
  await page.getByTestId('tab-assessment').click();
  const unsupported = page.locator('[data-verdict="UNSUPPORTED"]').first();
  await expect(unsupported).toBeVisible();
  await shot(page, '41-analyst-assessment-claims', { fullPage: true });
  await unsupported.getByRole('button', { name: /attach evidence/i }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await shot(page, '42-analyst-attach-evidence-dialog');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await unsupported.getByRole('button', { name: /remove claim/i }).click();
  await fillRationale(page, RATIONALE.removeClaim);
  await shot(page, '43-analyst-remove-claim-dialog');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });

  // Risk tab: deterministic calculation, control rating, override with rationale (FR-RS-*, FR-OV-*).
  await page.getByTestId('tab-risk').click();
  await expect(page.getByTestId('risk-totals')).toBeVisible();
  await page.getByTestId('show-formula-btn').click();
  await expect(page.getByTestId('formula')).toBeVisible();
  await shot(page, '44-analyst-risk-tab-formula', { fullPage: true });

  await page.getByTestId('control-btn-geography').click();
  await page.getByTestId('rating-adequate').check();
  await fillRationale(page, RATIONALE.control);
  await shot(page, '45-analyst-control-rating-dialog');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });

  await page.getByTestId('override-btn-geography').click();
  await page.getByTestId('score-3').check();
  await page.getByTestId('rationale-input').fill('short');
  await expect(page.getByTestId('dialog-submit')).toBeDisabled();
  await page.getByTestId('rationale-input').fill(RATIONALE.override);
  await expect(page.getByTestId('dialog-submit')).toBeEnabled();
  await shot(page, '46-analyst-override-dialog');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId('risk-totals')).toBeVisible();
  await shot(page, '47-analyst-risk-after-override', { fullPage: true });

  // History: append-only audit trail with hash-chain verification (FR-AU-*).
  await page.getByTestId('tab-history').click();
  await page.getByTestId('verify-btn').click();
  await expect(page.getByTestId('integrity-status')).toContainText(/verified/i, { timeout: 15_000 });
  await shot(page, '48-analyst-history-verified', { fullPage: true });

  // Overview: blockers cleared → finalize to committee (FR-WF-05).
  await page.getByTestId('tab-overview').click();
  const finalize = page.getByTestId('finalize-btn');
  const reason = page.getByTestId('finalize-btn-reason');
  if (await reason.count()) {
    // Any remaining information request is accepted as a documented gap.
    const gapBtns = page.locator('[data-testid^="accept-gap-"]');
    await page.getByTestId('tab-facts').click();
    await resolveRemainingContradictions(page);
    while ((await gapBtns.count()) > 0) {
      await gapBtns.first().click();
      await fillRationale(page, RATIONALE.acceptGap);
      await page.getByTestId('dialog-submit').click();
      await expect(page.getByRole('dialog')).toBeHidden({ timeout: 15_000 });
    }
    await page.getByTestId('tab-overview').click();
  }
  await expect(finalize).toBeEnabled({ timeout: 15_000 });
  await shot(page, '49-analyst-overview-ready-to-finalize', { fullPage: true });
  await finalize.click();
  await expect(page.getByText(/COMMITTEE[ _]REVIEW/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '50-analyst-finalized-to-committee', { fullPage: true });
});

// ---------------------------------------------------------------------------------------------
test('60 risk committee: review packet, decide with conditions, close', async ({ page }) => {
  await signIn(page, 'committee.lee');
  await openCase(page, 'RA-1001', 'committee');
  await expect(page.getByTestId('packet')).toBeVisible();
  await expect(page.getByTestId('decision-block')).toBeVisible();
  await shot(page, '60-committee-packet-and-decision-block', { fullPage: true });

  await page.getByTestId('decision-APPROVE_WITH_CONDITIONS').check();
  await page
    .getByTestId('condition-0')
    .fill('Vendor sanctions screening attestation to be filed before go-live.');
  await page.getByTestId('rationale-input').fill(RATIONALE.decision);
  await expect(page.getByTestId('record-decision-btn')).toBeEnabled();
  await shot(page, '61-committee-decision-filled', { fullPage: true });
  await page.getByTestId('record-decision-btn').click();
  await expect(page.getByTestId('decision-recorded')).toBeVisible({ timeout: 15_000 });
  await shot(page, '62-committee-decision-recorded', { fullPage: true });

  await page.getByTestId('close-case-btn').click();
  await expect(page.getByText(/CLOSED/).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '63-committee-case-closed', { fullPage: true });

  await page.getByTestId('tab-history').click();
  await page.getByTestId('verify-btn').click();
  await expect(page.getByTestId('integrity-status')).toContainText(/verified/i, { timeout: 15_000 });
  await shot(page, '64-committee-history-verified', { fullPage: true });
});

// ---------------------------------------------------------------------------------------------
test('70 admin: quality center, live adversarial test, ops, risk model publish', async ({ page }) => {
  await signIn(page, 'admin.raj');
  await page.getByRole('link', { name: 'Quality Center' }).click();
  await expect(page.getByTestId('release-status')).toBeVisible();
  await shot(page, '70-admin-quality-center', { fullPage: true });

  await page.getByTestId('run-prompt_injection').click();
  const card = page.getByTestId('adversarial-prompt_injection');
  await expect(card.getByText(/PASS|FAIL/).first()).toBeVisible({ timeout: 120_000 });
  await card.scrollIntoViewIfNeeded();
  await shot(card, '71-admin-adversarial-prompt-injection-result');

  await page.getByRole('link', { name: 'Ops' }).click();
  await expect(page.getByRole('heading', { name: /Operations/ })).toBeVisible();
  await shot(page, '72-admin-ops-dashboard', { fullPage: true });

  await page.getByRole('link', { name: 'Admin' }).click();
  await expect(page.getByTestId('risk-model-editor')).toBeVisible();
  await page.getByTestId('weight-geography').fill('25');
  await page.getByTestId('weight-transaction').fill('15');
  await expect(page.getByTestId('weights-hint')).toContainText('100');
  await page
    .getByTestId('risk-model-notes')
    .fill('Raise geography weight after Q3 sanctions review; offset transaction weight.');
  await expect(page.getByTestId('publish-risk-model-btn')).toBeEnabled();
  await shot(page, '73-admin-risk-model-editor', { fullPage: true });
  await page.getByTestId('publish-risk-model-btn').click();
  await expect(page.getByText(/published/i).first()).toBeVisible({ timeout: 15_000 });
  await shot(page, '74-admin-risk-model-published', { fullPage: true });
});

// ---------------------------------------------------------------------------------------------
test('80 product owner: final state of the case list', async ({ page }) => {
  await signIn(page, 'owner.pat');
  await expect(page.getByTestId('case-row-RA-1001')).toContainText(/CLOSED/i);
  if (newCaseRef) await expect(page.getByTestId(`case-row-${newCaseRef}`)).toBeVisible();
  await shot(page, '80-owner-case-list-final', { fullPage: true });
  await page.getByTestId('case-row-RA-1001').click();
  await page.getByTestId('tab-committee').click();
  await expect(page.getByTestId('decision-recorded')).toBeVisible();
  await shot(page, '81-owner-sees-decision', { fullPage: true });
  test.info().annotations.push({ type: 'new-case', description: `${newCaseRef} ${newCasePath}` });
});

// ---------------------------------------------------------------------------------------------
test('90 render workflow diagrams to PNG', async ({ page }) => {
  for (const name of ['case-lifecycle', 'pipeline', 'role-journeys']) {
    const url = pathToFileURL(join(DIAGRAMS, `${name}.svg`)).href;
    await page.goto(url);
    const svg = page.locator('svg');
    const box = await svg.boundingBox();
    if (box) await page.setViewportSize({ width: Math.ceil(box.width), height: Math.ceil(box.height) });
    await page.screenshot({ path: join(DIAGRAMS, `${name}.png`) });
  }
});
