/**
 * End-to-end checks for the Published PMOs list against the production build:
 * address round-trip for search and filters, history behaviour while typing,
 * clearing filters, and restoring search, filters and scroll position on Back.
 */
import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { largeCatalogue } from "../src/features/published/testing";

import { expect, test } from "./fixtures/privacy";

const LARGE_CATALOGUE = largeCatalogue(150);

// Prevent the offline service worker from intercepting the mocked catalogue route.
test.use({ serviceWorkers: "block" });

async function serveLargeCatalogue(page: Page): Promise<void> {
  await page.route("**/repository/index.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(LARGE_CATALOGUE),
    });
  });
}

async function chooseOption(page: Page, label: string, option: string | RegExp): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option }).click();
}

test("keeps search, multiple countries and species in the address, loads a copied address, and clears cleanly", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.goto("/?lang=en#/published");
  const status = page.getByRole("status");
  await expect(status).toHaveText("150 datasets");
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published");

  const historyBeforeSearch = await page.evaluate(() => window.history.length);
  const searchBox = page.getByRole("searchbox", { name: "Search" });
  await searchBox.pressSequentially("vivax");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published?q=vivax");

  // Typing in the search replaces the current entry instead of adding one per letter.
  expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeSearch);
  expect(await page.evaluate(() => window.location.search)).toBe("?lang=en");
  const vivaxCount = await page.locator("article").count();
  expect(vivaxCount).toBeGreaterThan(0);
  await expect(status).toHaveText(`${vivaxCount} of 150 datasets`);

  await searchBox.fill("");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published");

  await page.getByRole("button", { name: /^Country:/ }).click();
  await page.getByRole("checkbox", { name: /^Kenya \(\d+\)$/ }).click();
  await page.getByRole("checkbox", { name: /^Uganda \(\d+\)$/ }).click();
  await page.keyboard.press("Escape");

  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?country=Kenya&country=Uganda");

  await chooseOption(page, "Species", /^Plasmodium falciparum \(\d+\)$/);
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?country=Kenya&country=Uganda&species=5833");

  const copiedUrl = page.url();
  const filteredTitles = await page
    .locator("article h3")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
  expect(filteredTitles.length).toBeGreaterThan(0);

  // Loading the copied address in a fresh visit shows the exact same list.
  await page.goto("about:blank");
  await page.goto(copiedUrl);
  await expect(page.getByRole("button", { name: /^Country:/ })).toContainText("2 countries");
  await expect(page.getByRole("combobox", { name: "Species" })).toContainText(
    "Plasmodium falciparum",
  );
  const reloadedTitles = await page
    .locator("article h3")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
  expect(reloadedTitles).toEqual(filteredTitles);

  // Clearing the filters resets both the list and the address.
  await page.getByRole("button", { name: "Clear the filters" }).click();
  await expect(status).toHaveText("150 datasets");
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published");
});

test("restores search, filters and scroll position when going Back from a dataset", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  await page.getByRole("searchbox", { name: "Search" }).fill("20");
  await chooseOption(page, "Panel", /^Mad4hatter \(\d+\)$/);
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?q=20&panel=Mad4hatter");

  const articles = page.locator("article");
  const matchCount = await articles.count();
  expect(matchCount).toBeGreaterThanOrEqual(15);

  // Scroll well down the filtered list, then open a dataset in view.
  const targetRow = articles.nth(10);
  const targetLink = targetRow.getByRole("link");
  const targetTitle = (await targetLink.textContent()) ?? "";
  expect(targetTitle).not.toBe("");

  await targetRow.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo({ top: Math.max(window.scrollY, 900) }));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(900);
  const scrollBeforeOpen = await page.evaluate(() => window.scrollY);

  await targetLink.click();
  await expect(page.getByRole("heading", { level: 1, name: targetTitle })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toMatch(/^#\/published\/\d+$/);

  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Published PMOs" })).toBeVisible();
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("20");
  await expect(page.getByRole("combobox", { name: "Panel" })).toContainText("Mad4hatter");
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published?q=20&panel=Mad4hatter");
  await expect(articles).toHaveCount(matchCount);

  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThanOrEqual(scrollBeforeOpen - 20);
  const scrollAfterBack = await page.evaluate(() => window.scrollY);
  expect(Math.abs(scrollAfterBack - scrollBeforeOpen)).toBeLessThanOrEqual(20);
});

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

function boxesOverlap(a: Box, b: Box): boolean {
  return !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
}

function parseCount(text: string | undefined): number {
  return Number((text ?? "").replaceAll(",", ""));
}

interface TotalsLayout {
  readonly regionRect: Box;
  readonly numbers: readonly {
    readonly text: string;
    readonly rect: Box;
    readonly overflowX: number;
  }[];
  readonly labels: readonly {
    readonly text: string;
    readonly rect: Box;
  }[];
  readonly pageOverflowX: number;
}

function assertNoTotalsOverlap(layout: TotalsLayout): void {
  expect(layout.pageOverflowX).toBeLessThanOrEqual(0);
  for (const num of layout.numbers) {
    expect(num.overflowX).toBeLessThanOrEqual(1);
    expect(num.rect.left).toBeGreaterThanOrEqual(layout.regionRect.left - 1);
    expect(num.rect.right).toBeLessThanOrEqual(layout.regionRect.right + 1);
  }
  for (let i = 0; i < layout.numbers.length; i += 1) {
    const a = layout.numbers[i];
    const labelA = layout.labels[i];
    if (a === undefined || labelA === undefined) continue;
    expect(boxesOverlap(a.rect, labelA.rect)).toBe(false);
    for (let j = i + 1; j < layout.numbers.length; j += 1) {
      const b = layout.numbers[j];
      if (b === undefined) continue;
      expect(boxesOverlap(a.rect, b.rect)).toBe(false);
    }
  }
}

test("totals follow filters and fit without overlap at 390 px with six-digit specimens", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  const totalsRegion = page.getByRole("region", { name: "Totals" });
  await expect(totalsRegion).toBeVisible();
  await expect(totalsRegion.getByText("Filtered list")).toBeHidden();

  const inspectTotalsLayout = async (): Promise<TotalsLayout> =>
    totalsRegion.evaluate((region) => {
      const regionRect = region.getBoundingClientRect();
      const numbers = [...region.querySelectorAll("dd")].map((dd) => {
        const range = document.createRange();
        range.selectNodeContents(dd);
        const rect = range.getBoundingClientRect();
        return {
          text: dd.textContent?.trim() ?? "",
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          overflowX: dd.scrollWidth - dd.clientWidth,
        };
      });
      const labels = [...region.querySelectorAll("dt")].map((dt) => {
        const range = document.createRange();
        range.selectNodeContents(dt);
        const rect = range.getBoundingClientRect();
        return {
          text: dt.textContent?.trim() ?? "",
          rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        };
      });
      return {
        regionRect: {
          left: regionRect.left,
          right: regionRect.right,
          top: regionRect.top,
          bottom: regionRect.bottom,
        },
        numbers,
        labels,
        pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

  const unfiltered = await inspectTotalsLayout();
  expect(unfiltered.numbers).toHaveLength(3);
  expect(unfiltered.numbers[0]?.text).toBe("150");
  expect(unfiltered.numbers[1]?.text).toMatch(/^\d{3},\d{3}$/);
  expect(unfiltered.numbers[2]?.text).toBe("26");
  assertNoTotalsOverlap(unfiltered);

  // Filtering updates the totals and shows that the list is filtered.
  await page.getByRole("button", { name: /^Country:/ }).click();
  await page.getByRole("checkbox", { name: /^Kenya \(\d+\)$/ }).click();
  await page.keyboard.press("Escape");
  await expect(totalsRegion.getByText("Filtered list")).toBeVisible();
  const filtered = await inspectTotalsLayout();
  expect(parseCount(filtered.numbers[0]?.text)).toBeGreaterThan(0);
  expect(parseCount(filtered.numbers[0]?.text)).toBeLessThan(150);
  expect(parseCount(filtered.numbers[1]?.text)).toBeGreaterThan(0);
  expect(parseCount(filtered.numbers[1]?.text)).toBeLessThan(
    parseCount(unfiltered.numbers[1]?.text),
  );
  expect(parseCount(filtered.numbers[2]?.text)).toBeGreaterThanOrEqual(1);
  expect(parseCount(filtered.numbers[2]?.text)).toBeLessThan(26);
  assertNoTotalsOverlap(filtered);

  // Clearing filters restores whole-catalogue totals and hides the filtered badge.
  await page.getByRole("button", { name: "Clear the filters" }).click();
  await expect(totalsRegion.getByText("Filtered list")).toBeHidden();
  await expect(totalsRegion.locator("dd").first()).toHaveText("150");
});

test("sorts the list from the keyboard, keeps sort in the address, and survives Back", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  await expect(page.getByText("Sort by", { exact: true })).toBeVisible();
  const sortControl = page.getByLabel("Sort by");
  await expect(sortControl).toContainText("Newest published");

  const firstTitle = () => page.locator("article h3").first().textContent();
  expect(await firstTitle()).toBe(LARGE_CATALOGUE.datasets[0]?.title);

  // Change sort using the keyboard alone: focus, open, move to "Most specimens", select.
  await sortControl.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("listbox")).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(sortControl).toContainText("Most specimens");
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?sort=specimens");
  const maxSpecimens = Math.max(
    ...LARGE_CATALOGUE.datasets.map((entry) => entry.summary.specimens),
  );
  const mostSpecimensEntry = LARGE_CATALOGUE.datasets.find(
    (entry) => entry.summary.specimens === maxSpecimens,
  );
  expect(await firstTitle()).toBe(mostSpecimensEntry?.title);

  // Open the top dataset and press Back: sort stays in the address and list order.
  await page.locator("article a").first().click();
  await expect(
    page.getByRole("heading", { level: 1, name: mostSpecimensEntry?.title ?? "" }),
  ).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: "Published PMOs" })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published?sort=specimens");
  await expect(sortControl).toContainText("Most specimens");
  expect(await firstTitle()).toBe(mostSpecimensEntry?.title);

  // Check remaining orders and return to default clean address.
  await chooseOption(page, "Sort by", "Latest collection year");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published?sort=year");
  const newest2026Entry = LARGE_CATALOGUE.datasets.find(
    (entry) => entry.collectionYears?.last === 2026,
  );
  expect(await firstTitle()).toBe(newest2026Entry?.title);

  await chooseOption(page, "Sort by", "Title");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published?sort=title");
  expect((await firstTitle()) ?? "").toMatch(/^Angola /);

  await chooseOption(page, "Sort by", "Newest published");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published");
  expect(await firstTitle()).toBe(LARGE_CATALOGUE.datasets[0]?.title);
});

test("opens the coverage grid, navigates and selects a cell from the keyboard, and filters the list", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  const toggle = page.getByRole("button", { name: /Coverage by country and year/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const grid = page.getByRole("table", { name: "Specimens by country and collection year" });
  await expect(grid).toBeVisible();
  await expect(page.getByText("0 specimens", { exact: true })).toBeVisible();
  await expect(page.getByText(/specimens \(log scale\)/)).toBeVisible();

  // Move across cells with arrow keys and pick a populated cell via Enter.
  const firstCell = grid.locator("tbody button").first();
  await firstCell.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");

  const readout = page.getByTestId("coverage-readout");
  await expect(readout).toContainText("Benin, 2009:");

  // Choose the first populated cell for Benin in 2009 (or move to a populated Angola cell).
  const populatedCell = grid
    .getByRole("button", { name: /^Angola, 2008: .+ in \d+ published PMOs?$/ })
    .first();
  await populatedCell.focus();
  await expect(readout).toContainText("Angola, 2008:");
  await page.keyboard.press("Enter");

  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?country=Angola&year=2008");
  await expect(populatedCell).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /^Country:/ })).toContainText("Angola");
  await expect(page.getByRole("combobox", { name: "Collected in" })).toContainText("2008");
  expect(await page.locator("article").count()).toBeGreaterThan(0);

  // Choosing the active cell again clears the country and year filters.
  await page.keyboard.press("Enter");
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published");
  await expect(page.getByRole("status")).toHaveText("150 datasets");
});

test("keeps the coverage grid scrolling inside its own area at 390 px with no page overflow", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  await page.getByRole("button", { name: /Coverage by country and year/ }).click();
  const scrollBox = page.getByTestId("coverage-scroll");
  await expect(scrollBox).toBeVisible();

  const metrics = await scrollBox.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const readout = document
      .querySelector('[data-testid="coverage-readout"]')
      ?.getBoundingClientRect();
    return {
      boxScrollWidth: el.scrollWidth,
      boxClientWidth: el.clientWidth,
      boxRight: box.right,
      readoutRight: readout?.right ?? 0,
      pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });

  expect(metrics.boxScrollWidth).toBeGreaterThan(metrics.boxClientWidth);
  expect(metrics.boxRight).toBeLessThanOrEqual(390);
  expect(metrics.readoutRight).toBeLessThanOrEqual(390);
  expect(metrics.pageOverflowX).toBeLessThanOrEqual(0);
});

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test(`coverage grid passes axe WCAG 2.2 AA in the ${colorScheme} theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await serveLargeCatalogue(page);
    await page.goto("/#/published");
    await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
    await expect(page.getByText("150 datasets")).toBeVisible();

    await page.getByRole("button", { name: /Coverage by country and year/ }).click();
    const grid = page.getByRole("table", { name: "Specimens by country and collection year" });
    await expect(grid).toBeVisible();
    await grid.locator("tbody button").first().focus();

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const serious = results.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map(
        (violation) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ${violation.nodes
            .slice(0, 5)
            .map((node) => node.target.join(" "))
            .join(", ")}`,
      );
    expect(serious).toEqual([]);
  });
}

test("shows at least ten compact rows per screen at 1280 by 800, clamps long titles and shortens long author lists", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  const list = page.locator("article");
  await expect(list).toHaveCount(150);

  // Scroll the start of the list below the sticky top bar and count how many entries fit on one 1280x800 screen.
  const visibleOnScreen = await page.evaluate(() => {
    const articles = [...document.querySelectorAll("article")];
    const first = articles[0];
    if (first === undefined) return 0;
    const header = document.querySelector("header");
    const topBarHeight = header?.getBoundingClientRect().bottom ?? 0;
    const targetTop = first.getBoundingClientRect().top + window.scrollY - topBarHeight;
    window.scrollTo({ top: Math.max(0, targetTop) });
    return articles.filter((article) => {
      const rect = article.getBoundingClientRect();
      return rect.top >= topBarHeight - 1 && rect.bottom <= window.innerHeight + 1;
    }).length;
  });
  expect(visibleOnScreen).toBeGreaterThanOrEqual(10);

  // A long title (> 120 chars) is visually clamped to at most two lines while exposing the full title on the link.
  const longEntry = LARGE_CATALOGUE.datasets.find((entry) => entry.title.length > 120);
  expect(longEntry).toBeDefined();
  if (longEntry === undefined) return;
  const longLink = page.getByRole("link", { name: longEntry.title });
  await expect(longLink).toHaveAttribute("title", longEntry.title);
  const clamped = await longLink.locator("span").evaluate((span) => {
    const lineHeight = Number.parseFloat(getComputedStyle(span).lineHeight);
    return { height: span.getBoundingClientRect().height, lineHeight };
  });
  expect(clamped.height).toBeLessThanOrEqual(clamped.lineHeight * 2 + 2);

  // Entries with more than two authors show the first author and "et al.".
  const manyAuthorsEntry = LARGE_CATALOGUE.datasets.find((entry) => entry.creators.length > 2);
  expect(manyAuthorsEntry).toBeDefined();
  if (manyAuthorsEntry === undefined) return;
  const firstAuthor = manyAuthorsEntry.creators[0];
  expect(firstAuthor).toBeDefined();
  await expect(
    page
      .locator("article", { hasText: manyAuthorsEntry.title })
      .getByText(`${firstAuthor} et al.`, { exact: false }),
  ).toBeVisible();
});

test("switches to table view, syncs column sorting with Sort by, and survives Back", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  const tableToggle = page.getByRole("radio", { name: "Table" });
  const listToggle = page.getByRole("radio", { name: "List" });
  await expect(listToggle).toHaveAttribute("aria-checked", "true");

  await tableToggle.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published?view=table");
  await expect(tableToggle).toHaveAttribute("aria-checked", "true");

  const table = page.getByRole("table");
  await expect(table).toBeVisible();
  const headers = await table
    .getByRole("columnheader")
    .evaluateAll((cells) => cells.map((cell) => cell.textContent?.trim() ?? ""));
  expect(headers).toEqual([
    "Title",
    "First author",
    "Country",
    "Collection years",
    "Panel",
    "Species",
    "Specimens",
  ]);

  const sortControl = page.getByRole("combobox", { name: "Sort by" });
  const specimensHeader = table.getByRole("columnheader", { name: /Specimens/ });
  await specimensHeader.getByRole("button").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?sort=specimens&view=table");
  await expect(sortControl).toContainText("Most specimens");
  await expect(specimensHeader).toHaveAttribute("aria-sort", "descending");

  const maxSpecimens = Math.max(
    ...LARGE_CATALOGUE.datasets.map((entry) => entry.summary.specimens),
  );
  const mostSpecimensEntry = LARGE_CATALOGUE.datasets.find(
    (entry) => entry.summary.specimens === maxSpecimens,
  );
  const firstRowLink = table.locator("tbody tr").first().getByRole("link");
  await expect(firstRowLink).toHaveText(mostSpecimensEntry?.title ?? "");

  const yearsHeader = table.getByRole("columnheader", { name: /Collection years/ });
  await yearsHeader.getByRole("button").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?sort=year&view=table");
  await expect(sortControl).toContainText("Latest collection year");
  await expect(yearsHeader).toHaveAttribute("aria-sort", "descending");

  const titleHeader = table.getByRole("columnheader", { name: /Title/ });
  await titleHeader.getByRole("button").click();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?sort=title&view=table");
  await expect(sortControl).toContainText("Title");
  await expect(titleHeader).toHaveAttribute("aria-sort", "ascending");

  const openedTitle = (await firstRowLink.textContent()) ?? "";
  expect(openedTitle).toMatch(/^Angola /);
  await firstRowLink.click();
  await expect(page.getByRole("heading", { level: 1, name: openedTitle })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole("table")).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published?sort=title&view=table");
  await expect(tableToggle).toHaveAttribute("aria-checked", "true");
  await expect(table.getByRole("columnheader", { name: /Title/ })).toHaveAttribute(
    "aria-sort",
    "ascending",
  );

  await listToggle.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("#/published?sort=title");
  await expect(page.getByRole("table")).toBeHidden();
  await expect(page.locator("article").first()).toBeVisible();
});

test("keeps both list and table views usable at 390 px without horizontal page scroll", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();

  const listOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(listOverflow).toBeLessThanOrEqual(0);

  await page.getByRole("radio", { name: "Table" }).click();
  const tableRegion = page.getByRole("region", { name: "Published PMOs table" });
  await expect(tableRegion).toBeVisible();
  await expect(tableRegion).toHaveAttribute("tabindex", "0");

  const tableLayout = await tableRegion.evaluate((region) => ({
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    regionOverflowX: region.scrollWidth - region.clientWidth,
    regionRight: region.getBoundingClientRect().right,
    viewportWidth: window.innerWidth,
  }));
  expect(tableLayout.pageOverflowX).toBeLessThanOrEqual(0);
  expect(tableLayout.regionOverflowX).toBeGreaterThan(0);
  expect(tableLayout.regionRight).toBeLessThanOrEqual(tableLayout.viewportWidth + 1);

  const firstLink = tableRegion.locator("tbody tr").first().getByRole("link");
  const title = (await firstLink.textContent()) ?? "";
  await firstLink.click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
});
