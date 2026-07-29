import { expect, type Page, test } from "./fixtures/ensureLoggedIn";
import { waitForAutosave } from "./utils";
import { ensureAppLocale } from "./utils/locale";

async function setFormatAndRead(
  page: Page,
  locale: "en" | "ar",
  variant: "12" | "24",
) {
  await page.goto(`/${locale}/settings`);
  const formatOption = page.getByTestId(`time-format-${variant}h`);
  if (!(await formatOption.isChecked())) {
    await waitForAutosave(page, () => formatOption.click());
  }
  await page.goto(`/${locale}`);
  await expect(page).toHaveURL(new RegExp(`/${locale}$`));
  const lastUpdated = page.getByTestId("last-updated");
  await expect(lastUpdated).toBeVisible();
  return (await lastUpdated.textContent()) ?? "";
}

// Locale-specific formatting is covered for every published locale by the
// date-time unit tests. This E2E test only verifies the complete UI, autosave,
// persistence, and rendering flow for representative LTR and RTL locales.
test("time format setting persists across representative locales", async ({
  page,
}) => {
  await ensureAppLocale(page, "en");

  const en12 = await setFormatAndRead(page, "en", "12");
  expect(en12).toMatch(/AM|PM/);

  const en24 = await setFormatAndRead(page, "en", "24");
  expect(en24).not.toMatch(/AM|PM/);
  expect(en24).toMatch(/\d{1,2}:\d{2}/);
  expect(en24).not.toBe(en12);

  await page.reload();
  await expect(page.getByTestId("last-updated")).toContainText(/\d{1,2}:\d{2}/);
  await expect(page.getByTestId("last-updated")).not.toContainText(/AM|PM/);

  await ensureAppLocale(page, "ar");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

  const ar12 = await setFormatAndRead(page, "ar", "12");
  expect(ar12).toMatch(/(?:^|\s)[صم](?:\s|$)/u);

  const ar24 = await setFormatAndRead(page, "ar", "24");
  expect(ar24).not.toMatch(/(?:^|\s)[صم](?:\s|$)/u);
  expect(ar24).toMatch(/[0-9٠-٩]{1,2}:[0-9٠-٩]{2}/u);
  expect(ar24).not.toBe(ar12);
});
