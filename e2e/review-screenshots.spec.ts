/**
 * Screenshots of the review step in each verdict state, at desktop and phone
 * sizes, light and dark, for looking over by eye. Off unless
 * `REVIEW_SHOTS_DIR` names a folder to write them to:
 *
 *   REVIEW_SHOTS_DIR=/tmp/shots pnpm e2e review-screenshots
 *
 * Example files are altered on their way to the page (from the app's own
 * origin) to reach the states the example alone does not.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample, openStep, verdictCard } from "./support/review";

const OUT = process.env["REVIEW_SHOTS_DIR"] ?? "";
const EXAMPLES = fileURLToPath(new URL("../public/examples/", import.meta.url));

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;
const SCHEMES = ["light", "dark"] as const;

/** Serves an example file with `edit` applied. */
async function alterExample(
  page: Page,
  fileName: string,
  edit: (text: string) => string,
): Promise<void> {
  const text = readFileSync(join(EXAMPLES, fileName), "utf8");
  await page
    .context()
    .route(`**/examples/${fileName}`, (route) =>
      route.fulfill({ status: 200, contentType: "text/plain", body: edit(text) }),
    );
}

interface State {
  readonly name: string;
  /** Brings the page to the state, ending on the review step. */
  readonly reach: (page: Page) => Promise<void>;
  /** Opens every notice list and the preview. */
  readonly expand?: boolean;
}

const STATES: readonly State[] = [
  {
    name: "empty",
    reach: async (page) => {
      await page.goto("/#/review");
      await expect(verdictCard(page).getByRole("heading", { name: "Not ready yet" })).toBeVisible();
    },
  },
  {
    name: "not-ready-panel-missing",
    reach: async (page) => {
      await page.goto("/#/microhaplotypes");
      await page
        .getByLabel("Choose allele table file")
        .setInputFiles(join(EXAMPLES, "mad4hatter_allele_data_example.csv"));
      await expect(
        page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
      ).toBeVisible({ timeout: BUILD_TIMEOUT });
      await openStep(page, "Review and download");
      await expect(verdictCard(page)).toContainText("Panel is needed");
    },
  },
  {
    name: "not-ready-merge-failed",
    reach: async (page) => {
      // A target of the allele table is missing from the panel.
      await alterExample(page, "mad4hatter_panel_info_example.csv", (text) =>
        text
          .split("\n")
          .filter((line) => !line.includes("Pf3D7_01_v3-145388-145662-1A"))
          .join("\n"),
      );
      await loadExample(page);
      await openStep(page, "Review and download");
      await expect(verdictCard(page).getByRole("heading", { name: "Not ready yet" })).toBeVisible({
        timeout: BUILD_TIMEOUT,
      });
    },
    expand: true,
  },
  {
    name: "ready",
    reach: async (page) => {
      await loadExample(page);
      await openStep(page, "Review and download");
      await expect(
        verdictCard(page).getByRole("heading", { name: "Ready, with things to check" }),
      ).toBeVisible({ timeout: BUILD_TIMEOUT });
      await expect(verdictCard(page).getByText(/\.pmo\.json\.gz, /)).toBeVisible();
    },
  },
  {
    name: "check-warnings",
    reach: async (page) => {
      // A repeated row in the by-stage read counts gives a warning.
      await alterExample(
        page,
        "reads_per_stage.txt",
        (text) => `${text.trimEnd()}\n${text.split("\n")[1] ?? ""}\n`,
      );
      await loadExample(page);
      await openStep(page, "Review and download");
      await expect(
        verdictCard(page).getByRole("heading", { name: "Ready, with things to check" }),
      ).toBeVisible({ timeout: BUILD_TIMEOUT });
      await expect(verdictCard(page).getByText(/\.pmo\.json\.gz, /)).toBeVisible();
    },
  },
  {
    name: "check-invalid",
    reach: async (page) => {
      // Plate columns that are not numbers break the PMO format.
      await alterExample(page, "mad4hatter_metadata_example.tsv", (text) =>
        text.replaceAll(/plate1\tA\t(\d+)/g, "plate1\tA\tcol$1"),
      );
      await loadExample(page);
      await openStep(page, "Review and download");
      await expect(
        verdictCard(page).getByRole("heading", { name: "Ready, with things to check" }),
      ).toBeVisible({ timeout: BUILD_TIMEOUT });
      await expect(verdictCard(page).getByText(/\.pmo\.json\.gz, /)).toBeVisible();
    },
    expand: true,
  },
];

async function expandAll(page: Page): Promise<void> {
  const check = page.getByRole("region", { name: "Things to check" });
  const showAll = check.getByRole("button", { name: /^Show all/ });
  // Each click renames its button, so always take the first one left.
  // oxlint-disable-next-line no-await-in-loop -- one list at a time.
  while ((await showAll.count()) > 0) {
    // oxlint-disable-next-line no-await-in-loop -- one list at a time.
    await showAll.first().click();
  }
  const preview = page.getByRole("button", { name: /Preview the PMO/ });
  if ((await preview.count()) > 0) {
    await preview.click();
    await expect(page.getByRole("region", { name: "PMO preview" })).toBeVisible({
      timeout: BUILD_TIMEOUT,
    });
  }
}

test.describe("review screenshots", () => {
  test.skip(OUT === "", "Set REVIEW_SHOTS_DIR to take screenshots of the review step.");
  test.describe.configure({ timeout: 120_000 });

  for (const state of STATES) {
    for (const viewport of VIEWPORTS) {
      test(`${state.name} at ${viewport.name} size`, async ({ page }) => {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await state.reach(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        for (const scheme of SCHEMES) {
          // oxlint-disable-next-line no-await-in-loop -- one scheme at a time.
          await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
          // oxlint-disable-next-line no-await-in-loop -- one scheme at a time.
          await page.screenshot({
            path: join(OUT, `${state.name}-${viewport.name}-${scheme}.png`),
            fullPage: true,
          });
          // What shows first, without scrolling.
          // oxlint-disable-next-line no-await-in-loop -- one scheme at a time.
          await page.screenshot({
            path: join(OUT, `${state.name}-${viewport.name}-${scheme}-first-screen.png`),
          });
        }
        if (state.expand === true) {
          await expandAll(page);
          for (const scheme of SCHEMES) {
            // oxlint-disable-next-line no-await-in-loop -- one scheme at a time.
            await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
            // oxlint-disable-next-line no-await-in-loop -- one scheme at a time.
            await page.screenshot({
              path: join(OUT, `${state.name}-open-${viewport.name}-${scheme}.png`),
              fullPage: true,
            });
          }
        }
      });
    }
  }
});
