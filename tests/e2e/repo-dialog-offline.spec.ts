import { test, expect } from '@playwright/test';
import { login, ensureTestRepo, goOffline, goOnline, waitForAutosave } from './utils';

const OFFLINE_NOTICE_EN = 'Offline – changes are read-only and auto-save is paused.';
const OFFLINE_NOTICE_DE = 'Offline – Änderungen sind schreibgeschützt, automatisches Speichern ist pausiert.';

test.describe('Repo dialog offline read-only + autosave pause', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    await ensureTestRepo(page);
    await page.goto('/en');
  });

  test('controls disabled offline, notice visible, reset disabled; re-enable online and autosave works', async ({ page }) => {
    // Open settings dialog for first repo
    await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Go offline: notice appears and controls disabled
    await goOffline(page);
    const notice = dialog.getByText(OFFLINE_NOTICE_EN).or(dialog.getByText(OFFLINE_NOTICE_DE));
    await expect(notice).toBeVisible();

    // Representative controls disabled
    await expect(dialog.getByLabel('Stable')).toBeDisabled();
    await expect(dialog.getByLabel('Pre-release')).toBeDisabled();
    await expect(dialog.getByLabel('Include Pattern').or(dialog.getByLabel('Einschließen-Muster (Include)'))).toBeDisabled();
    await expect(dialog.getByLabel('Exclude Pattern').or(dialog.getByLabel('Ausschließen-Muster (Exclude)'))).toBeDisabled();

    // The releases-per-page field - find by type
    const rppInput = dialog.locator('input[type="number"]').first();
    await expect(rppInput).toBeDisabled();

    // All "Reset" buttons should be disabled while offline
    const resetButtonsEn = dialog.getByRole('button', { name: 'Reset' });
    const resetButtonsDe = dialog.getByRole('button', { name: 'Zurücksetzen' });
    const countEn = await resetButtonsEn.count();
    for (let i = 0; i < countEn; i++) {
      await expect(resetButtonsEn.nth(i)).toBeDisabled();
    }
    const countDe = await resetButtonsDe.count();
    for (let i = 0; i < countDe; i++) {
      await expect(resetButtonsDe.nth(i)).toBeDisabled();
    }

    // Autosave paused indicator
    await expect(dialog.getByText(/Offline – saving paused|Offline – Speichern pausiert/)).toBeVisible();

    // Go online: controls re-enabled
    await goOnline(page);
    await expect(dialog.getByLabel('Stable')).toBeEnabled();

    // Make a small change to trigger autosave
    const rpp = dialog.locator('input[type="number"]').first();
    await rpp.fill('7');
    await waitForAutosave(page);
  });

  test('scroll container allows reaching bottom content', async ({ page }) => {
    await page.getByRole('button', { name: 'Open settings for this repository' }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Find Apprise section elements and ensure they are visible after scroll
    const appriseLabel = dialog.getByRole('heading', { name: 'Apprise Settings' }).or(
      dialog.getByRole('heading', { name: 'Apprise-Einstellungen' })
    );
    // In case it's already visible, still perform a scroll to bottom
    await dialog.evaluate((node) => {
      const scrollers = Array.from(node.querySelectorAll('div')) as HTMLElement[];
      const target = scrollers.find(el => getComputedStyle(el).overflowY === 'auto' || el.className.includes('overflow-y-auto'));
      if (target) target.scrollTop = target.scrollHeight;
      else window.scrollTo(0, document.body.scrollHeight);
    });
    await expect(appriseLabel).toBeVisible();
  });
});
