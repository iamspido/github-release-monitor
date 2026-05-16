import { test, expect } from '@playwright/test';
import { ensureRepositoryFormExpanded, login } from './utils';

test.describe('GitLab self-hosted repository add flow', () => {
  test('adds a repository from allowed additional gitlab host', async ({ page }) => {
    await login(page);
    await page.goto('/en');

    const idSuffix = Date.now();
    const owner = `e2e-owner-${idSuffix}`;
    const repo = `e2e-repo-${idSuffix}`;
    const repoUrl = `https://gitlab.self.test/${owner}/${repo}`;

    await ensureRepositoryFormExpanded(page);
    await page.locator('textarea[name="urls"]').fill(repoUrl);
    await page
      .locator('form')
      .getByRole('button', { name: 'Add Repositories', exact: true })
      .click();

    await expect(page.getByText('Repositories Processed', { exact: true })).toBeVisible();
    await expect(page.getByText('Update Complete', { exact: true })).toBeVisible();

    await page.goto('/en');
    await expect(
      page.locator(`a[href="${repoUrl}"]`).first(),
    ).toBeVisible({ timeout: 15_000 });
  });

  test('rejects repository from non-allowed gitlab host', async ({ page }) => {
    await login(page);
    await page.goto('/en');

    const repoUrl = 'https://gitlab.not-allowed.test/t.hohmann/tagesmutter-hohmann';
    await ensureRepositoryFormExpanded(page);
    await page.locator('textarea[name="urls"]').fill(repoUrl);
    await page
      .locator('form')
      .getByRole('button', { name: 'Add Repositories', exact: true })
      .click();

    await expect(page.getByText('Processing Failed', { exact: true })).toBeVisible();
    await expect(page.getByText('1 invalid URLs provided.', { exact: true })).toBeVisible();
    await expect(page.locator('a[href*="gitlab.not-allowed.test"]')).toHaveCount(0);
  });
});
