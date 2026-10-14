import { expect, type Page, test } from '@playwright/test';

async function signIn(page: Page, username: string) {
  await page.goto('/signin');
  await page.getByTestId(`tile-${username}`).click();
  await page.waitForURL(/\/cases/);
}

async function openSeededCase(page: Page) {
  await signIn(page, 'analyst.kim');
  await page.getByTestId('case-row-RA-1001').click();
  await page.waitForURL(/\/cases\/.+/);
}

test('unauthenticated users are redirected from a protected case route', async ({ page }) => {
  await page.goto('/cases');
  await page.waitForURL(/\/signin/);
  await expect(page.getByRole('heading', { name: 'Choose who you are for this session' })).toBeVisible();
});

test('the alternate user picker signs in with the selected role', async ({ page }) => {
  await page.goto('/signin');
  await page.getByTestId('user-select').selectOption('owner.pat');
  await page.getByTestId('user-select-continue').click();
  await page.waitForURL(/\/cases/);
  await expect(page.getByTestId('role-badge')).toContainText(/Product Owner/i);
});

test('switch user ends the current session and allows a different role to sign in', async ({ page }) => {
  await signIn(page, 'owner.pat');
  await page.getByTestId('user-menu').click();
  await page.getByTestId('switch-user').click();
  await page.waitForURL(/\/signin/);
  await page.getByTestId('tile-committee.lee').click();
  await page.waitForURL(/\/cases/);
  await expect(page.getByTestId('role-badge')).toContainText(/Risk Committee/i);
});

test('analysts can inspect the risk model but cannot open its publishing editor', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toHaveCount(0);
  await page.goto('/admin/risk-model');
  await expect(page.getByTestId('active-risk-model')).toBeVisible();
  await expect(page.getByTestId('risk-model-editor')).toHaveCount(0);
  await expect(
    page.getByText('Only the FCRM Administrator can publish a new risk model version.'),
  ).toBeVisible();
});

test('administrators can open the risk-model editor with valid initial weights', async ({ page }) => {
  await signIn(page, 'admin.raj');
  await expect(page.getByRole('link', { name: 'Admin', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Admin', exact: true }).click();
  await expect(page.getByTestId('risk-model-editor')).toBeVisible();
  await expect(page.getByTestId('weights-hint')).toHaveAttribute('data-ok', 'true');
});

test('case search filters by reference and shows an empty state for no match', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  const search = page.getByRole('textbox', { name: 'Search' });
  await search.fill('RA-1001');
  await expect(page.getByTestId('case-row-RA-1001')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await search.fill('no-such-case-ref');
  await expect(page.getByText('No cases match.')).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(0);
});

test('case-state filtering retains only cases in the selected state', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  const targetRow = page.getByTestId('case-row-RA-1001');
  await expect(targetRow).toBeVisible();
  const state = await targetRow.locator('[data-state]').getAttribute('data-state');
  expect(state).toBeTruthy();
  await page.locator('#filter-state').selectOption(state!);
  await expect(targetRow).toBeVisible();
  for (const row of await page.locator('tbody tr').all()) {
    await expect(row.locator('[data-state]')).toHaveAttribute('data-state', state!);
  }
});

test('change-type filtering keeps matching cases and excludes non-matches', async ({ page }) => {
  await signIn(page, 'analyst.kim');
  const targetRow = page.getByTestId('case-row-RA-1001');
  await expect(targetRow).toBeVisible();
  const typeLabel = (await targetRow.locator('td').nth(2).innerText()).trim();
  const typeValue = typeLabel.toLowerCase().replace(/\s+/g, '_');
  await page.getByRole('combobox', { name: 'Filter by change type' }).selectOption(typeValue);
  await expect(targetRow).toBeVisible();
  for (const row of await page.locator('tbody tr').all()) {
    await expect(row.locator('td').nth(2)).toHaveText(typeLabel);
  }
});

test('case workspace tabs navigate to the requested panels and keep the URL hash in sync', async ({
  page,
}) => {
  await openSeededCase(page);
  const tabs = [
    ['facts', 'facts-table'],
    ['evidence', 'policy-evidence'],
    ['assessment', 'assessment-summary'],
    ['history', 'history'],
  ] as const;
  for (const [tab, panel] of tabs) {
    await page.getByTestId(`tab-${tab}`).click();
    await expect(page).toHaveURL(new RegExp(`#${tab}$`));
    await expect(page.getByTestId(panel)).toBeVisible();
  }
  await page.getByTestId('tab-committee').click();
  await expect(page).toHaveURL(/#committee$/);
  await expect(page.getByTestId('packet')).toBeVisible();
});

test('sample documents populate a valid new-case form without submitting it', async ({ page }) => {
  await signIn(page, 'owner.pat');
  await page.getByTestId('new-case-btn').click();
  await expect(page).toHaveURL(/\/cases\/new$/);
  await expect(page.getByTestId('sample-card')).toBeVisible();
  const submit = page.getByTestId('create-case-btn');
  await expect(submit).toBeDisabled();
  await page.getByTestId('use-sample-btn').click();
  await expect(page.getByTestId('sample-selected')).toBeVisible();
  await expect(page.getByTestId('case-title')).not.toHaveValue('');
  await expect(page.getByTestId('case-description')).toHaveValue(/.{50,}/);
  await expect(page.getByTestId('sample-file-row').first()).toBeVisible();
  await expect(submit).toBeEnabled();
});
