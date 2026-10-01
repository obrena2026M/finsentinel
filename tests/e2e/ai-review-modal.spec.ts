import { expect, test } from '@playwright/test';

// The "AI Review In Progress" modal must open immediately from the case-list Re-run button and step
// through the bullets at a visible pace (UX §4.4). The test server runs with MOCK_LATENCY_MS=0, so the
// client-side pacing (≥1.7 s per bullet) is what keeps the modal on screen.

test('Re-run from the case list opens the AI Review modal and animates through the steps', async ({
  page,
}) => {
  await page.goto('/signin');
  await page.getByTestId('tile-analyst.kim').click();
  await page.waitForURL(/\/cases/);
  await page.getByTestId('rerun-RA-1002').click();

  const modal = page.getByTestId('ai-review-modal');
  await expect(modal).toBeVisible({ timeout: 3000 });
  await expect(modal.getByRole('heading')).toContainText(/AI Review In Progress/);
  await expect(page.getByTestId('ai-review-step-parse')).toHaveAttribute('data-status', /checking|done/);

  // The first bullet must still be visible as "checking" or "done" while later ones are pending — i.e. paced.
  await expect(page.getByTestId('ai-review-step-packet')).toHaveAttribute('data-status', 'pending');
  // Eventually every bullet is checked and the modal offers to open the case.
  await expect(page.getByTestId('ai-review-step-packet')).toHaveAttribute('data-status', 'done', {
    timeout: 60_000,
  });
  await expect(modal.getByRole('heading')).toContainText(/AI Review complete/);
  await page.getByTestId('ai-review-open-case').click();
  await page.waitForURL(/\/cases\/.+#overview/);
});
