/**
 * Working without a connection: once the app has been opened online, its
 * service worker keeps a copy, so it opens offline and builds the example
 * there, worker and all.
 */
import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample, verdictCard } from "./support/review";

test("opens and builds the example without a connection, after one visit online", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first page load is not controlled by the worker; the next one is.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "PMO Builder" })).toBeVisible();
    await loadExample(page);
    await page.goto("/#/build/review");
    await expect(verdictCard(page)).toContainText("Ready", { timeout: BUILD_TIMEOUT });
    await expect(page.getByRole("button", { name: "Download PMO" })).toBeEnabled();
  } finally {
    await context.setOffline(false);
  }
});
