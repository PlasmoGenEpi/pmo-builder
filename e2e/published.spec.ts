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

async function chooseOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("keeps search and country in the address, loads a copied address, and clears cleanly", async ({
  page,
}) => {
  await serveLargeCatalogue(page);
  await page.goto("/?lang=en#/published");
  await expect(page.getByText("150 datasets")).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe("#/published");

  const historyBeforeSearch = await page.evaluate(() => window.history.length);
  const searchBox = page.getByRole("searchbox", { name: "Search" });
  await searchBox.pressSequentially("surveillance");
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?q=surveillance");

  // Typing in the search replaces the current entry instead of adding one per letter.
  expect(await page.evaluate(() => window.history.length)).toBe(historyBeforeSearch);
  expect(await page.evaluate(() => window.location.search)).toBe("?lang=en");

  await chooseOption(page, "Country", "Kenya");
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe("#/published?q=surveillance&country=Kenya");

  const copiedUrl = page.url();
  const filteredTitles = await page
    .locator("article h3")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
  expect(filteredTitles.length).toBeGreaterThan(0);

  // Loading the copied address in a fresh visit shows the exact same list.
  await page.goto("about:blank");
  await page.goto(copiedUrl);
  await expect(page.getByRole("searchbox", { name: "Search" })).toHaveValue("surveillance");
  await expect(page.getByRole("combobox", { name: "Country" })).toContainText("Kenya");
  const reloadedTitles = await page
    .locator("article h3")
    .evaluateAll((headings) => headings.map((heading) => heading.textContent ?? ""));
  expect(reloadedTitles).toEqual(filteredTitles);

  // Clearing the filters resets both the list and the address.
  await page.getByRole("button", { name: "Clear the filters" }).click();
  await expect(page.getByText("150 datasets")).toBeVisible();
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
  await chooseOption(page, "Panel", "Mad4hatter");
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
