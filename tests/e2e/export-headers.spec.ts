import { expect, test } from "./fixtures/ensureLoggedIn";
import { login } from "./utils";

test("export sets application/json blob type and file name", async ({
  page,
}) => {
  await login(page);

  // Inject hooks to capture Blob type and anchor download name
  await page.addInitScript(() => {
    type ExportCaptureWindow = Window & {
      __lastBlobType?: string | null;
      __lastDownloadName?: string;
    };
    const captureWindow = window as ExportCaptureWindow;
    const orig = URL.createObjectURL;
    captureWindow.__lastBlobType = null;
    URL.createObjectURL = (blob: Blob) => {
      captureWindow.__lastBlobType = blob.type;
      return orig.call(URL, blob);
    };

    const origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      captureWindow.__lastDownloadName = this.download;
      return origClick.call(this);
    };
  });

  await page.goto("/en");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Export" }).click(),
  ]);
  const suggested = download.suggestedFilename();
  expect(suggested).toBe("repositories.json");

  const blobType = await page.evaluate(() => {
    return (window as Window & { __lastBlobType?: string | null })
      .__lastBlobType;
  });
  expect(blobType).toBe("application/json");

  const dlName = await page.evaluate(() => {
    return (window as Window & { __lastDownloadName?: string })
      .__lastDownloadName;
  });
  expect(dlName).toBe("repositories.json");
});
