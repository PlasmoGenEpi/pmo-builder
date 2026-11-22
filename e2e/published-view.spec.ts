/**
 * End-to-end checks for the read-only published view at `#/published/:id/:tab`:
 * - Navigating from a dataset page keeps `#/published/:id/summary`
 * - Header shows title, authors, dataset page link and Zenodo record link
 * - Only Overview, Summary, Compare and Tables tabs show (no Replace, Remove,
 *   Original/Subset, Subset or Publish)
 * - Switching tabs keeps the address in sync without re-downloading
 * - A pre-existing working PMO and its subset survive untouched in `#/pmo`
 * - "Work with this file" asks before replacing an open working PMO (naming it
 *   and its subset); cancelling leaves both intact, confirming replaces them
 *   without re-downloading, and with no working PMO it hands off directly
 * - Reloading `#/published/:id/:tab` preserves the address and re-opens the view
 * - Legacy `#/pmo/published/:id/:tab` redirects to `#/published/:id/:tab`
 *
 * Serves both the catalogue and the PMO bytes on the app's own origin via
 * `page.route`, keeping the privacy fixture strictly green.
 */
import { readFile } from "node:fs/promises";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, downloadFrom, loadExample } from "./support/review";

// Block the offline service worker so `page.route` intercepts the fixture
// catalogue and PMO bytes directly, including across `page.reload()`.
test.use({ serviceWorkers: "block" });

const DATASET_ID = "303";
const DATASET_TITLE = "Border travellers, Mozambique and Eswatini";
const DATASET_AUTHORS = ["Okello, Grace", "Mensah, Kofi"];
const DATASET_ZENODO_URL = `https://zenodo.org/records/${DATASET_ID}`;
const DATASET_FILE_NAME = "border-travellers.pmo.json.gz";
const DATASET_FILE_URL = `/fixtures/published/${DATASET_FILE_NAME}`;

function fixtureCatalogue(fileSize: number) {
  return {
    version: 2,
    harvestedAt: "2026-11-15T03:00:00.000Z",
    community: "pmocommunity",
    datasets: [
      {
        id: DATASET_ID,
        title: DATASET_TITLE,
        creators: DATASET_AUTHORS,
        published: "2026-11-14",
        version: null,
        licence: { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" },
        doi: `10.5281/zenodo.${DATASET_ID}`,
        zenodoUrl: DATASET_ZENODO_URL,
        file: {
          name: DATASET_FILE_NAME,
          size: fileSize,
          url: DATASET_FILE_URL,
          fingerprint: null,
        },
        summary: {
          specimens: 50,
          librarySamples: 50,
          librarySamplesWithDetections: 49,
          panels: 1,
          targets: 276,
          targetsWithCalls: 21,
          genomes: 0,
          sequencingRuns: 1,
          projects: 1,
          bioinformaticsRuns: 1,
          librarySamplesWithReadCounts: 0,
        },
        panels: ["Mad4hatter"],
        countries: ["Eswatini", "Mozambique"],
        collectionYears: { first: 2015, last: 2019 },
        taxa: [5833, 5855],
        bioProjects: [],
      },
    ],
  };
}

test("published view keeps its address, shows header and 4 tabs, leaves working PMO untouched, and survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });

  // Build the example PMO and open it in My PMO file so we have both real PMO
  // bytes to serve as a fixture and an active working PMO + subset.
  await loadExample(page);
  await page.evaluate(() => {
    globalThis.location.hash = "/pmo/open-built";
  });
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  // Download the built PMO bytes from Overview to serve as the published fixture.
  await page.getByRole("tab", { name: "Overview" }).click();
  const downloaded = await downloadFrom(page, page.getByRole("button", { name: "Download" }));
  const pmoBytes = await readFile(await downloaded.path());

  // Make a subset in My PMO file so we can verify both file and subset survive.
  await page.getByRole("tab", { name: "Subset" }).click();
  await page.getByLabel(/Minimum reads per microhaplotype/).fill("100");
  const makeButton = page.getByRole("button", { name: "Make the subset" });
  await expect(makeButton).toBeEnabled({ timeout: BUILD_TIMEOUT });
  await makeButton.click();
  await expect(page.getByText("The subset is ready")).toBeVisible({ timeout: BUILD_TIMEOUT });

  const workingHeader = page.locator("main header").first();
  await expect(
    workingHeader.getByRole("heading", { level: 1, name: "Mad4hatter.pmo.json.gz" }),
  ).toBeVisible();
  await expect(
    workingHeader
      .getByRole("radiogroup", { name: "Work with" })
      .getByRole("radio", { name: "Subset" }),
  ).toBeChecked();

  // Serve the fixture catalogue and PMO bytes locally (no network traffic to Zenodo).
  let pmoFetches = 0;
  const catalogueJson = JSON.stringify(fixtureCatalogue(pmoBytes.byteLength));
  await page.route("**/repository/index.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: catalogueJson,
    });
  });
  await page.route(`**${DATASET_FILE_URL}`, async (route) => {
    pmoFetches += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/gzip",
      body: pmoBytes,
    });
  });

  // Visit the dataset page and open "See its summary".
  await page.evaluate((id) => {
    globalThis.location.hash = `/published/${id}`;
  }, DATASET_ID);
  const summaryLink = page.getByRole("link", { name: "See its summary" });
  await expect(summaryLink).toBeVisible({ timeout: BUILD_TIMEOUT });
  await summaryLink.click();

  // Address keeps the record id and tab.
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/summary$`));
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await expect(page.getByText("Reads by sample and target")).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  expect(pmoFetches).toBe(1);

  // Header shows title, authors, dataset page link and Zenodo record link.
  const publishedHeader = page.locator("main header").first();
  await expect(
    publishedHeader.getByRole("heading", { level: 1, name: DATASET_TITLE }),
  ).toBeVisible();
  await expect(publishedHeader.getByText(DATASET_AUTHORS.join("; "))).toBeVisible();
  await expect(publishedHeader.getByRole("link", { name: "Dataset page" })).toHaveAttribute(
    "href",
    `#/published/${DATASET_ID}`,
  );
  await expect(publishedHeader.getByRole("link", { name: /Zenodo record/ })).toHaveAttribute(
    "href",
    DATASET_ZENODO_URL,
  );

  // Exactly 4 read-only tabs and no working-PMO controls.
  const tabs = page.getByRole("tab");
  await expect(tabs).toHaveText(["Overview", "Summary", "Compare", "Tables"]);
  await expect(page.getByRole("button", { name: /Replace/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Remove/i })).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Work with" })).toHaveCount(0);

  // Switching tabs updates the URL and does not re-download.
  await page.getByRole("tab", { name: "Compare" }).click();
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/compare$`));
  await expect(page.getByRole("combobox", { name: "Group specimens by" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  await page.getByRole("tab", { name: "Tables" }).click();
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/tables$`));
  await expect(page.getByRole("button", { name: "Download all tables (.zip)" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/overview$`));
  await expect(page.getByText("This file is a valid PMO")).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  expect(pmoFetches).toBe(1);

  // "Work with this file" asks before replacing the open working PMO and its subset.
  await publishedHeader.getByRole("button", { name: "Work with this file" }).click();
  const replaceDialog = page.getByRole("alertdialog");
  await expect(replaceDialog).toBeVisible();
  await expect(replaceDialog).toContainText("Mad4hatter.pmo.json.gz");
  await expect(replaceDialog).toContainText("Mad4hatter-subset.json.gz");

  // Cancelling keeps the published view open and leaves the working PMO and subset intact.
  await replaceDialog.getByRole("button", { name: "Cancel" }).click();
  await expect(replaceDialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/overview$`));
  expect(pmoFetches).toBe(1);

  // Returning to My PMO file: the working PMO and its subset are still there untouched.
  await page
    .getByRole("navigation", { name: "Sections" })
    .getByRole("link", { name: "My PMO file" })
    .click();
  await expect(
    page
      .locator("main header")
      .first()
      .getByRole("heading", { level: 1, name: "Mad4hatter.pmo.json.gz" }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(
    page
      .locator("main header")
      .first()
      .getByRole("radiogroup", { name: "Work with" })
      .getByRole("radio", { name: "Subset" }),
  ).toBeChecked();

  // Confirming "Work with this file" replaces the working PMO and opens the same tab in My PMO file.
  await page.evaluate((id) => {
    globalThis.location.hash = `/published/${id}/summary`;
  }, DATASET_ID);
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  const fetchesBeforeConfirm = pmoFetches;
  await page
    .locator("main header")
    .first()
    .getByRole("button", { name: "Work with this file" })
    .click();
  const confirmDialog = page.getByRole("alertdialog");
  await expect(confirmDialog).toContainText("Mad4hatter.pmo.json.gz");
  await expect(confirmDialog).toContainText("Mad4hatter-subset.json.gz");
  await confirmDialog.getByRole("button", { name: "Replace it" }).click();

  await expect(page).toHaveURL(/#\/pmo\/summary$/);
  await expect(
    page.locator("main header").first().getByRole("heading", { level: 1, name: DATASET_FILE_NAME }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Subset" })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Work with" })).toHaveCount(0);
  expect(pmoFetches).toBe(fetchesBeforeConfirm);
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("This is a published PMO")).toBeVisible({ timeout: BUILD_TIMEOUT });

  // Visiting a published view address directly and reloading preserves the view.
  await page.evaluate((id) => {
    globalThis.location.hash = `/published/${id}/tables`;
  }, DATASET_ID);
  await expect(page.getByRole("tab", { name: "Tables", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  const fetchesBeforeReload = pmoFetches;

  await page.reload();
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/tables$`));
  await expect(
    page.locator("main header").first().getByRole("heading", { level: 1, name: DATASET_TITLE }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(page.getByRole("tab", { name: "Tables", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: "Download all tables (.zip)" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  expect(pmoFetches).toBe(fetchesBeforeReload + 1);

  // Legacy /pmo/published/:id/:tab redirects to /published/:id/:tab.
  await page.evaluate((id) => {
    globalThis.location.hash = `/pmo/published/${id}/summary`;
  }, DATASET_ID);
  await expect(page).toHaveURL(new RegExp(`#/published/${DATASET_ID}/summary$`));
  await expect(page.getByRole("tab", { name: "Summary", selected: true })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  // After reload there is no working PMO, so "Work with this file" opens My PMO file directly.
  const fetchesBeforeDirect = pmoFetches;
  await page
    .locator("main header")
    .first()
    .getByRole("button", { name: "Work with this file" })
    .click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page).toHaveURL(/#\/pmo\/summary$/);
  await expect(
    page.locator("main header").first().getByRole("heading", { level: 1, name: DATASET_FILE_NAME }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(page.getByRole("tab", { name: "Subset" })).toBeVisible();
  expect(pmoFetches).toBe(fetchesBeforeDirect);
});
