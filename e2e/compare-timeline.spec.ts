/**
 * End-to-end tests for the Compare tab's collection timeline:
 * - Fits its container at 1280 px with the example data so the last month is visible without scrolling.
 * - Does not make the page scroll sideways at 390 px.
 * - When it must scroll (390 px with example data, or many months at 1280 px), shows a continuation
 *   cue on the right and lets mouse and keyboard reach the last collection month.
 * - Draws a 1-specimen month as a small bar above the axis even when another month exceeds 40.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { openBuiltExample, openSyntheticPmo } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

/** Opens the built example on the Compare tab and waits for the timeline to appear. */
async function openExampleCompare(page: Page): Promise<Locator> {
  await openBuiltExample({ page, tab: "compare" });
  const timeline = page.getByRole("region", { name: "When specimens were collected" });
  await expect(timeline).toBeVisible({ timeout: BUILD_TIMEOUT });
  return timeline;
}

/** Builds a valid synthetic PMO spanning 100 months, with 45 specimens in one month and 1 in the last. */
function longSkewedPmo(): Record<string, unknown> {
  const specimens: Record<string, unknown>[] = [];
  const libraries: Record<string, unknown>[] = [];
  let id = 0;
  const add = (country: string, date: string) => {
    specimens.push({
      specimen_name: `spec_${id}`,
      collection_country: country,
      collection_date: date,
    });
    libraries.push({
      library_sample_name: `lib_${id}`,
      specimen_id: id,
      panel_id: 0,
    });
    id += 1;
  };
  // 45 specimens in the first month so a 1-specimen month has bar height < 4 px.
  for (let i = 0; i < 45; i += 1) add("Mozambique", "2015-01-10");
  // 1 specimen in the last month (100 months later: 2023-04 -> 100 months inclusive).
  add("Kenya", "2023-04-15");

  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [{ panel_name: "p", reactions: [{ reaction_name: "r1", panel_targets: [0] }] }],
    target_info: [
      {
        target_name: "t1",
        forward_primer: { seq: "ACGT" },
        reverse_primer: { seq: "TGCA" },
      },
    ],
    specimen_info: specimens,
    library_sample_info: libraries,
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: [{ target_id: 0, microhaplotypes: [{ seq: "AAAA" }, { seq: "AAAT" }] }],
    },
    detected_microhaplotypes: [
      {
        bioinformatics_run_id: 0,
        library_samples: [
          {
            library_sample_id: 0,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 50 }] }],
          },
          {
            library_sample_id: id - 1,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 1, reads: 50 }] }],
          },
        ],
      },
    ],
  };
}

/** Whether the last period label is completely inside the scroll region's visible horizontal bounds. */
async function lastLabelInView(timeline: Locator, lastPeriod: string): Promise<boolean> {
  const regionBox = await timeline.boundingBox();
  const labelBox = await timeline.locator("svg text", { hasText: lastPeriod }).last().boundingBox();
  if (regionBox === null || labelBox === null) return false;
  return (
    labelBox.x >= regionBox.x - 1 &&
    labelBox.x + labelBox.width <= regionBox.x + regionBox.width + 1
  );
}

/** Scrolls a focused horizontal scroll region to its right end using the keyboard. */
async function keyboardScrollToEnd(page: Page, timeline: Locator): Promise<void> {
  await timeline.focus();
  await expect(timeline).toBeFocused();
  for (let step = 0; step < 60; step += 1) {
    // oxlint-disable-next-line no-await-in-loop -- step-by-step keyboard scrolling.
    const atEnd = await timeline.evaluate(
      (el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    );
    if (atEnd) break;
    // oxlint-disable-next-line no-await-in-loop -- step-by-step keyboard scrolling.
    await page.keyboard.press("ArrowRight");
  }
}

test("at 1280 px with example data the last collection month is visible without scrolling", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const timeline = await openExampleCompare(page);

  const metrics = await timeline.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(await lastLabelInView(timeline, "2019-08")).toBe(true);
  const wrapper = timeline.locator("..");
  await expect(wrapper.locator('[data-continues="right"]')).toHaveCount(0);
  await expect(wrapper.locator('[data-continues="left"]')).toHaveCount(0);
});

test("at 390 px the chart scrolls inside its own area with a cue and no page overflow", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const timeline = await openExampleCompare(page);
  await timeline.scrollIntoViewIfNeeded();

  // The timeline section itself does not overflow the 390 px viewport.
  const timelineBox = await timeline.boundingBox();
  expect(timelineBox).not.toBeNull();
  if (timelineBox !== null) {
    expect(timelineBox.x + timelineBox.width).toBeLessThanOrEqual(390 + 1);
  }
  const pageOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(pageOverflow).toBeLessThanOrEqual(0);

  // It must scroll horizontally at 390 px and show that it continues to the right.
  const initial = await timeline.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
    scrollLeft: el.scrollLeft,
  }));
  expect(initial.scrollWidth).toBeGreaterThan(initial.clientWidth);
  expect(initial.scrollLeft).toBe(0);

  const wrapper = timeline.locator("..");
  const rightCue = wrapper.locator('[data-continues="right"]');
  const leftCue = wrapper.locator('[data-continues="left"]');
  await expect(rightCue).toBeVisible();
  await expect(leftCue).toHaveCount(0);

  // Mouse horizontal wheel reaches the end and clears the right cue.
  if (timelineBox !== null) {
    await page.mouse.move(
      timelineBox.x + timelineBox.width / 2,
      timelineBox.y + timelineBox.height / 2,
    );
    await page.mouse.wheel(2000, 0);
  }
  await expect
    .poll(() => timeline.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1))
    .toBe(true);
  expect(await lastLabelInView(timeline, "2019-08")).toBe(true);
  await expect(rightCue).toHaveCount(0);
  await expect(leftCue).toBeVisible();

  // Scroll back to start with mouse, then reach the end with keyboard ArrowRight.
  if (timelineBox !== null) {
    await page.mouse.wheel(-2000, 0);
  }
  await expect.poll(() => timeline.evaluate((el) => el.scrollLeft)).toBe(0);
  await expect(rightCue).toBeVisible();
  await expect(leftCue).toHaveCount(0);

  await keyboardScrollToEnd(page, timeline);
  await expect
    .poll(() => timeline.evaluate((el) => el.scrollLeft + el.clientWidth >= el.scrollWidth - 1))
    .toBe(true);
  expect(await lastLabelInView(timeline, "2019-08")).toBe(true);
});

test("a long timeline with a >40 peak scrolls with cue and keeps its 1-specimen bar above the axis", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSyntheticPmo({
    page,
    fileName: "skewed.json",
    pmo: longSkewedPmo(),
    tab: "compare",
  });
  const timeline = page.getByRole("region", { name: "When specimens were collected" });
  await expect(timeline).toBeVisible({ timeout: BUILD_TIMEOUT });
  await timeline.scrollIntoViewIfNeeded();

  // 100 months cannot fit at readable bar width inside 1280 px, so it scrolls with a right cue.
  const wrapper = timeline.locator("..");
  await expect(wrapper.locator('[data-continues="right"]')).toBeVisible();

  await keyboardScrollToEnd(page, timeline);
  expect(await lastLabelInView(timeline, "2023-04")).toBe(true);

  // Check in real browser layout that both bars (45 specimens and 1 specimen) sit strictly above the axis.
  const barGeometry = await timeline.evaluate((el) => {
    const svg = el.querySelector("svg");
    const axis = svg?.querySelector("line");
    if (svg === null || axis === null || axis === undefined) return null;
    const axisRect = axis.getBoundingClientRect();
    const bars = [...svg.querySelectorAll("g > path")].map((path) => {
      const rect = path.getBoundingClientRect();
      return {
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        width: rect.width,
      };
    });
    return { axisTop: axisRect.top, axisBottom: axisRect.bottom, bars };
  });
  expect(barGeometry).not.toBeNull();
  if (barGeometry !== null) {
    expect(barGeometry.bars).toHaveLength(2);
    for (const bar of barGeometry.bars) {
      expect(bar.bottom).toBeLessThanOrEqual(barGeometry.axisBottom);
      expect(bar.height).toBeGreaterThanOrEqual(1);
      expect(bar.width).toBeGreaterThanOrEqual(2);
    }
  }
});
