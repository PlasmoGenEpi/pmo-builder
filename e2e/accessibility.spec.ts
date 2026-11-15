/**
 * Accessibility against the production build: axe checks the home page,
 * every step and the review page with the example loaded, in the light and
 * the dark theme, and fails on serious or critical violations. The privacy
 * fixture also fails each test on any request to another origin.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, loadExample } from "./support/review";

/** Every page, with the heading that says it has loaded. Follows `src/app/steps.ts`. */
const PAGES: readonly { readonly hash: string; readonly heading: string }[] = [
  { hash: "#/", heading: "PMO Builder" },
  { hash: "#/pmo", heading: "My PMO file" },
  { hash: "#/build/microhaplotypes", heading: "Microhaplotypes" },
  { hash: "#/build/panel", heading: "Panel" },
  { hash: "#/build/specimens", heading: "Specimens" },
  { hash: "#/build/library-samples", heading: "Library samples" },
  { hash: "#/build/project", heading: "Project" },
  { hash: "#/build/sequencing", heading: "Sequencing" },
  { hash: "#/build/bioinformatics", heading: "Bioinformatics" },
  { hash: "#/build/read-counts", heading: "Read counts by stage" },
  { hash: "#/build/review", heading: "Review and download" },
];

/** WCAG 2.2 A and AA, as AGENTS.md asks. */
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** The serious and critical violations on the page as it is now, one line each. */
async function seriousViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes
          .slice(0, 5)
          .map((node) => node.target.join(" "))
          .join(", ")}`,
    );
}

/** Opens every collapsed section in the page, so axe checks what is inside. */
async function openDisclosures(page: Page): Promise<void> {
  const closed = page.locator(
    'main button[aria-expanded="false"][data-state="closed"]:not([aria-haspopup]):not([role])',
  );
  // Each click can reveal more sections, so open the first closed one until none is left.
  for (let opened = 0; opened < 50; opened += 1) {
    // oxlint-disable-next-line no-await-in-loop -- each click can reveal more sections.
    if ((await closed.count()) === 0) return;
    // oxlint-disable-next-line no-await-in-loop -- each click can reveal more sections.
    await closed.first().click();
  }
}

for (const colorScheme of ["light", "dark"] as const) {
  test(`every page passes axe in the ${colorScheme} theme`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await loadExample(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    const found: Record<string, string[]> = {};
    for (const { hash, heading } of PAGES) {
      // oxlint-disable-next-line no-await-in-loop -- pages are checked one at a time.
      await page.evaluate((target) => {
        globalThis.location.hash = target;
      }, hash);
      // oxlint-disable-next-line no-await-in-loop -- pages are checked one at a time.
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible({
        timeout: BUILD_TIMEOUT,
      });
      // oxlint-disable-next-line no-await-in-loop -- let the page settle before checking.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: BUILD_TIMEOUT });
      // oxlint-disable-next-line no-await-in-loop -- pages are checked one at a time.
      await openDisclosures(page);
      // oxlint-disable-next-line no-await-in-loop -- pages are checked one at a time.
      const violations = await seriousViolations(page);
      if (violations.length > 0) found[hash] = violations;
    }
    // My PMO file with the example built and opened, on each of its tabs.
    await page.evaluate(() => {
      globalThis.location.hash = "/pmo/open-built";
    });
    await expect(page.getByText("This is the PMO built from your draft")).toBeVisible({
      timeout: BUILD_TIMEOUT,
    });
    for (const tab of ["Summary", "Compare", "Tables", "Subset"]) {
      // oxlint-disable-next-line no-await-in-loop -- tabs are checked one at a time.
      await page.getByRole("tab", { name: tab }).click();
      // oxlint-disable-next-line no-await-in-loop -- let the tab settle before checking.
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: BUILD_TIMEOUT });
      // oxlint-disable-next-line no-await-in-loop -- tabs are checked one at a time.
      const violations = await seriousViolations(page);
      if (violations.length > 0) found[`My PMO file: ${tab}`] = violations;
    }
    expect(found).toEqual({});
  });
}
