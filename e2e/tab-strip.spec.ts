/**
 * Tab strip scroll fade and distinct navigation landmark names against the
 * production build. The privacy fixture fails the test on any request to
 * another origin.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { openBuiltExample } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

/** Opens the example PMO in My PMO file and waits for its tab strip. */
async function openExampleInMyPmo(page: Page): Promise<Locator> {
  await openBuiltExample({ page, tab: "summary" });
  const tablist = page.getByRole("tablist", { name: "What to do with the file" });
  await expect(tablist).toBeVisible({ timeout: BUILD_TIMEOUT });
  return tablist;
}

/** Visible navigation landmarks' accessible names on the current page. */
async function visibleNavLandmarkNames(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll('nav, [role="navigation"]'));
    return navs
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== "none" &&
          style.visibility !== "hidden"
        );
      })
      .map((element) => {
        const ariaLabel = element.getAttribute("aria-label")?.trim();
        if (ariaLabel) return ariaLabel;
        const labelledBy = element.getAttribute("aria-labelledby");
        if (labelledBy) {
          return labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
            .join(" ")
            .trim();
        }
        return "";
      });
  });
}

test("390 px tab strip fades at edges with more tabs, clears at the end, and never blocks presses", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(PHONE);
  const tablist = await openExampleInMyPmo(page);

  const metrics = await tablist.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);

  const wrapper = tablist.locator("..");
  const leftFade = wrapper.locator('[data-fade="left"]');
  const rightFade = wrapper.locator('[data-fade="right"]');

  // Ensure we start scrolled to the left edge.
  await tablist.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(leftFade).toHaveAttribute("data-state", "hidden");
  await expect(rightFade).toHaveAttribute("data-state", "visible");
  await expect(leftFade).toHaveCSS("opacity", "0");
  await expect(rightFade).toHaveCSS("opacity", "1");
  await expect(leftFade).toHaveCSS("pointer-events", "none");
  await expect(rightFade).toHaveCSS("pointer-events", "none");

  // Pressing a tab underneath the right fade still selects that tab.
  const rightFadeBox = await rightFade.boundingBox();
  expect(rightFadeBox).not.toBeNull();
  const overlappingTab = await tablist.evaluate((list) => {
    const listRect = list.getBoundingClientRect();
    const fadeLeft = listRect.right - 32;
    const tabs = Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'));
    for (const tab of tabs) {
      if (tab.getAttribute("aria-selected") === "true") continue;
      const rect = tab.getBoundingClientRect();
      const overlapStart = Math.max(rect.left, fadeLeft);
      const overlapEnd = Math.min(rect.right, listRect.right);
      if (overlapEnd - overlapStart >= 4) {
        return {
          name: tab.textContent?.trim() ?? "",
          x: (overlapStart + overlapEnd) / 2,
          y: rect.top + rect.height / 2,
        };
      }
    }
    return null;
  });
  expect(overlappingTab).not.toBeNull();
  if (overlappingTab !== null) {
    const targetTab = tablist.getByRole("tab", { name: overlappingTab.name });
    await expect(targetTab).toHaveAttribute("aria-selected", "false");
    await page.mouse.click(overlappingTab.x, overlappingTab.y);
    await expect(targetTab).toHaveAttribute("aria-selected", "true");
  }

  // Scrolling partway shows fades on both edges.
  await tablist.evaluate((el) => {
    el.scrollLeft = Math.floor((el.scrollWidth - el.clientWidth) / 2);
  });
  await expect(leftFade).toHaveAttribute("data-state", "visible");
  await expect(rightFade).toHaveAttribute("data-state", "visible");
  await expect(leftFade).toHaveCSS("opacity", "1");
  await expect(rightFade).toHaveCSS("opacity", "1");

  // Scrolling to the end clears the right fade and keeps the left fade.
  await tablist.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await expect(leftFade).toHaveAttribute("data-state", "visible");
  await expect(rightFade).toHaveAttribute("data-state", "hidden");
  await expect(leftFade).toHaveCSS("opacity", "1");
  await expect(rightFade).toHaveCSS("opacity", "0");

  // Widening to desktop clears both fades when all tabs fit.
  await page.setViewportSize(DESKTOP);
  await expect(leftFade).toHaveAttribute("data-state", "hidden");
  await expect(rightFade).toHaveAttribute("data-state", "hidden");
  await expect(leftFade).toHaveCSS("opacity", "0");
  await expect(rightFade).toHaveCSS("opacity", "0");
});

test("tab strip fade respects prefers-reduced-motion", async ({ page }) => {
  test.setTimeout(60_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize(PHONE);
  const tablist = await openExampleInMyPmo(page);

  const wrapper = tablist.locator("..");
  const rightFade = wrapper.locator('[data-fade="right"]');
  await tablist.evaluate((el) => {
    el.scrollLeft = 0;
  });
  await expect(rightFade).toHaveAttribute("data-state", "visible");
  await expect(rightFade).toHaveCSS("transition-property", "none");

  await tablist.evaluate((el) => {
    el.scrollLeft = el.scrollWidth - el.clientWidth;
  });
  await expect(rightFade).toHaveAttribute("data-state", "hidden");
  await expect(rightFade).toHaveCSS("opacity", "0");
});

test("navigation landmarks have distinct accessible names on Summary and Build pages", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(DESKTOP);
  const tablist = await openExampleInMyPmo(page);

  await tablist.getByRole("tab", { name: "Summary" }).click();
  await expect(page.getByRole("navigation", { name: "On this page" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  const summaryNavs = await visibleNavLandmarkNames(page);
  expect(summaryNavs).toContain("Sections");
  expect(summaryNavs).toContain("On this page");
  expect(summaryNavs.every((name) => name.length > 0)).toBe(true);
  expect(new Set(summaryNavs).size).toBe(summaryNavs.length);

  await page.evaluate(() => {
    globalThis.location.hash = "/build/panel";
  });
  await expect(page.getByRole("heading", { level: 1, name: "Panel" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  const buildNavs = await visibleNavLandmarkNames(page);
  expect(buildNavs).toContain("Sections");
  expect(buildNavs).toContain("Steps");
  expect(buildNavs).toContain("Previous and next step");
  expect(buildNavs.every((name) => name.length > 0)).toBe(true);
  expect(new Set(buildNavs).size).toBe(buildNavs.length);
});
