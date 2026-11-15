/**
 * The review step against the production build: the example from the home
 * page to a downloaded, valid PMO; the upload path from an empty draft; the
 * verdict surviving a reload; and the download from the keyboard. The
 * privacy fixture fails each test on any request to another origin.
 */
import { fileURLToPath } from "node:url";

import { expect, test } from "./fixtures/privacy";
import {
  BUILD_TIMEOUT,
  checkDownload,
  downloadFrom,
  formatBytes,
  loadExample,
  openStep,
  readStats,
  verdictCard,
} from "./support/review";

const ALLELE_TABLE = fileURLToPath(
  new URL("../public/examples/mad4hatter_allele_data_example.csv", import.meta.url),
);
const PANEL_TABLE = fileURLToPath(
  new URL("../public/examples/mad4hatter_panel_info_example.csv", import.meta.url),
);

/** The example as the old app merged it: 50 samples, the MAD4HATTER panel and its read counts. */
const EXAMPLE_STATS = {
  Specimens: 50,
  "Library samples": 50,
  "With alleles found": 49,
  "With read counts": 3,
  Panels: 1,
  Targets: 276,
  "Targets with alleles": 21,
  Genomes: 0,
  Projects: 0,
  "Sequencing runs": 0,
  "Bioinformatics runs": 0,
};

test("downloads the example as a gzipped and a plain PMO that pass the checks", async ({
  page,
}) => {
  await loadExample(page);
  await openStep(page, "Review and download");

  const verdict = verdictCard(page);
  // The example's sample table names a project and a sequencing run that are not entered.
  await expect(verdict.getByRole("heading", { name: "Ready, with things to check" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  const shown = await readStats(page);
  expect(shown).toEqual(EXAMPLE_STATS);
  const check = page.getByRole("region", { name: "Things to check" });
  await expect(check.getByText("Project names that link to nothing")).toBeVisible();
  await expect(check.getByText("Sequencing run names that link to nothing")).toBeVisible();

  // Gzipped, from the primary button.
  const gzipButton = verdict.getByRole("button", { name: "Download PMO" });
  await expect(verdict.getByText(/^Mad4hatter\.pmo\.json\.gz, /)).toBeVisible();
  const gzip = await checkDownload(await downloadFrom(page, gzipButton), true);
  expect(gzip.fileName).toBe("Mad4hatter.pmo.json.gz");
  expect(gzip.stats).toEqual(shown);
  await expect(verdict.getByText(`${gzip.fileName}, ${formatBytes(gzip.bytes)}`)).toBeVisible();

  // Plain JSON, from the secondary button.
  const jsonButton = verdict.getByRole("button", { name: "Download as plain JSON" });
  const json = await checkDownload(await downloadFrom(page, jsonButton), false);
  expect(json.fileName).toBe("Mad4hatter.pmo.json");
  expect(json.stats).toEqual(shown);
  await expect(verdict.getByText(`${json.fileName}, ${formatBytes(json.bytes)}`)).toBeVisible();
  expect(json.bytes).toBeGreaterThan(gzip.bytes);
});

test("an uploaded allele table alone is not ready, and review says the panel is needed", async ({
  page,
}) => {
  await page.goto("/#/build/microhaplotypes");
  await expect(page.getByRole("heading", { level: 1, name: "Microhaplotypes" })).toBeVisible();
  await page.getByLabel("Choose allele table file").setInputFiles(ALLELE_TABLE);
  await expect(
    page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });

  await openStep(page, "Review and download");
  const verdict = verdictCard(page);
  await expect(verdict.getByRole("heading", { name: "Not ready yet" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  await expect(verdict.getByText("is needed and has nothing in it yet.")).toBeVisible();
  await expect(verdict).toContainText("Panel is needed and has nothing in it yet.");
  await expect(verdict.getByRole("button", { name: "Download PMO" })).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Steps" }).getByRole("listitem").filter({ hasText: "Panel" }),
  ).toContainText("Needed");

  await verdict.getByRole("link", { name: "Go to Panel" }).click();
  await expect(page).toHaveURL(/#\/build\/panel$/);
  await expect(page.getByRole("heading", { level: 1, name: "Panel" })).toBeVisible();

  // Add the panel and name it, then download.
  await page.getByLabel("Choose target table file").setInputFiles(PANEL_TABLE);
  await page.getByRole("textbox", { name: "Panel name" }).fill("Mad4hatter");
  await openStep(page, "Review and download");
  await expect(verdict.getByRole("heading", { name: /^Ready/ })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  const download = await downloadFrom(page, verdict.getByRole("button", { name: "Download PMO" }));
  const checked = await checkDownload(download, true);
  expect(checked.stats).toEqual(await readStats(page));
});

test("the verdict and numbers come back after a reload on the review step", async ({ page }) => {
  await loadExample(page);
  await openStep(page, "Review and download");
  await expect(
    verdictCard(page).getByRole("heading", { name: "Ready, with things to check" }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  const before = await readStats(page);

  // Let the debounced save land, then reload.
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.reload();
  await expect(page).toHaveURL(/#\/build\/review$/);
  await expect(
    verdictCard(page).getByRole("heading", { name: "Ready, with things to check" }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
  expect(await readStats(page)).toEqual(before);
  expect(before).toEqual(EXAMPLE_STATS);
});

test("the download button is reached and used from the keyboard alone", async ({ page }) => {
  await loadExample(page);
  await expect(page.getByRole("button", { name: "Draft saved" })).toBeVisible();
  await page.waitForTimeout(1_000);
  await page.goto("/#/build/review");
  await page.reload();

  const title = page.getByRole("heading", { level: 1, name: "Review and download" });
  await expect(title).toBeFocused();
  const button = verdictCard(page).getByRole("button", { name: "Download PMO" });
  await expect(button).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(title).toBeFocused();

  // Tab forward one key at a time until the button has focus.
  let presses = 0;
  // oxlint-disable-next-line no-await-in-loop -- one key at a time.
  while (!(await button.evaluate((element) => element === document.activeElement))) {
    presses += 1;
    expect(presses, "Tab presses from the title to the download button").toBeLessThanOrEqual(5);
    // oxlint-disable-next-line no-await-in-loop -- one key at a time.
    await page.keyboard.press("Tab");
  }
  const download = page.waitForEvent("download");
  await page.keyboard.press("Enter");
  const checked = await checkDownload(await download, true);
  expect(checked.fileName).toBe("Mad4hatter.pmo.json.gz");
});
