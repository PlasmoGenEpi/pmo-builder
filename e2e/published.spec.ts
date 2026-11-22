/**
 * End-to-end checks for the Published PMOs list against the production build:
 * address round-trip for search and filters, history behaviour while typing,
 * clearing filters, and restoring search, filters and scroll position on Back.
 */
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
