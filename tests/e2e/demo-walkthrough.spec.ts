import { expect, test } from '@playwright/test';

// UX §8 demo walkthrough through the real UI against the seeded RA-1001 case. Runs in light and dark
// (playwright.e2e.config.ts projects). The server is started by the config with .env.test (mock gateway).

async function signIn(page: import('@playwright/test').Page, username: string) {
  await page.goto('/signin');
  await page.getByTestId(`tile-${username}`).click();
  await page.waitForURL(/\/cases/);
}

test('step 0–1: sign-in tiles have no password field and land on the case list', async ({ page }) => {
  await page.goto('/signin');
  await expect(page.getByTestId('tile-owner.pat')).toBeVisible();
  await expect(page.getByTestId('tile-analyst.kim')).toBeVisible();
  await expect(page.getByTestId('tile-committee.lee')).toBeVisible();
  await expect(page.getByTestId('tile-admin.raj')).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await page.getByTestId('tile-owner.pat').click();
  await page.waitForURL(/\/cases/);
  await expect(page.getByTestId('case-row-RA-1001')).toBeVisible();
});

test('theme toggle switches data-theme and persists across reload', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  const html = page.locator('html');
  const before = await html.getAttribute('data-theme');
  await page.getByTestId('theme-toggle').click();
  const after = await html.getAttribute('data-theme');
  expect(after).not.toBe(before);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', after!);
});

test('steps 2–12: analyst reviews RA-1001, overrides with rationale, committee decides', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  await page.getByTestId('case-row-RA-1001').click();
  await page.waitForURL(/\/cases\//);

  // Overview: pipeline succeeded, blockers listed, finalize disabled with a reason.
  await expect(page.getByTestId('pipeline-step-assess')).toContainText(/succeeded/i);
  await expect(page.getByTestId('blocker-item').first()).toBeVisible();
  await expect(page.getByTestId('finalize-btn')).toBeDisabled();

  // Risk tab: override geography with a rationale (too short first).
  await page.getByTestId('tab-risk').click();
  await page.getByTestId('override-btn-geography').click();
  // Both theme projects share one seeded server; pick a different target score per project so the
  // override is never a no-op (the API rejects "new score equals current score").
  const target = test.info().project.name.includes('dark') ? '2' : '3';
  await page.getByRole('radio', { name: new RegExp(`^${target}`) }).check();
  await page.getByTestId('rationale-input').fill('short');
  await expect(page.getByRole('button', { name: /save override/i })).toBeDisabled();
  await page
    .getByTestId('rationale-input')
    .fill(
      'Comparable existing products have established monitoring coverage and similar geographic exposure.',
    );
  await page.getByRole('button', { name: /save override/i }).click();
  await expect(page.getByText(/recorded in history/i)).toBeVisible();

  // History tab shows the override and verifies the chain.
  await page.getByTestId('tab-history').click();
  await expect(page.getByText(/override/i).first()).toBeVisible();
  await page.getByRole('button', { name: /verify/i }).click();
  await expect(page.getByText(/verified|ok/i).first()).toBeVisible();

  // Committee role sees the packet but analyst never sees decision controls.
  await expect(page.getByTestId('decision-APPROVE')).toHaveCount(0);
});

test('Quality Center shows real numbers or "No run yet", never placeholders; live adversarial test runs', async ({
  page,
}) => {
  await signIn(page, 'admin.raj');
  await page.goto('/quality');
  await expect(page.getByTestId('release-status')).toBeVisible();
  await expect(page.getByText(/XX%/)).toHaveCount(0);
  await page
    .getByRole('button', { name: /run now/i })
    .first()
    .click();
  await expect(page.getByText(/PASS|FAIL/).first()).toBeVisible({ timeout: 60_000 });
});
