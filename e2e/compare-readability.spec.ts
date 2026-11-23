/**
 * End-to-end tests for Ticket #51 ("Make Microhaplotypes by group readable"):
 * - Grouped by collection month at 1280 px, the first column stays pinned on
 *   horizontal scroll in both Heterozygosity by target and Microhaplotypes by group.
 * - Scrolling vertically inside Microhaplotypes by group keeps its heading row pinned.
 * - The largest microhaplotype share fills its cell's bar track and smaller shares
 *   scale proportionally to it, with a cut-off line when more than 20 exist.
 */
import type { Locator } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import { openBuiltExample, openSyntheticPmo, requireBox } from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

/**
 * Builds a valid synthetic PMO with two countries and 25 microhaplotypes at one target:
 * - Kenya (20 detections): allele 0 = 50% (10), allele 1 = 25% (5), allele 2 = 10% (2),
 *   alleles 3..5 = 5% (1 each).
 * - Uganda (20 detections): allele 0 = 5% (1), alleles 6..24 = 5% (1 each).
 *
 * That gives 25 present microhaplotypes (so the table caps at 20, scrolls vertically,
 * and reports 5 rarer ones not shown) and clean 50% / 25% / 10% bar ratios.
 */
function manyAllelesPmo(): Record<string, unknown> {
  const bases = ["A", "C", "G", "T"] as const;
  const seqs = Array.from({ length: 25 }, (_, index) => {
    const a = bases[Math.floor(index / 16) % 4] ?? "A";
    const b = bases[Math.floor(index / 4) % 4] ?? "A";
    const c = bases[index % 4] ?? "A";
    return `AAAA${a}${b}${c}`;
  });

  const specimens: Record<string, unknown>[] = [];
  const libraries: Record<string, unknown>[] = [];
  const detections: Record<string, unknown>[] = [];

  const addSample = (country: string, mhapId: number) => {
    const id = specimens.length;
    specimens.push({
      specimen_name: `${country.toLowerCase()}_${id + 1}`,
      collection_country: country,
    });
    libraries.push({
      library_sample_name: `LIB_${id + 1}`,
      specimen_id: id,
      panel_id: 0,
    });
    detections.push({
      library_sample_id: id,
      target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: mhapId, reads: 100 }] }],
    });
  };

  // Kenya: 10x allele 0 (50%), 5x allele 1 (25%), 2x allele 2 (10%), 1x alleles 3..5 (5% each).
  for (let i = 0; i < 10; i += 1) addSample("Kenya", 0);
  for (let i = 0; i < 5; i += 1) addSample("Kenya", 1);
  for (let i = 0; i < 2; i += 1) addSample("Kenya", 2);
  for (let mhap = 3; mhap <= 5; mhap += 1) addSample("Kenya", mhap);

  // Uganda: 1x allele 0 (5%), 1x alleles 6..24 (5% each).
  addSample("Uganda", 0);
  for (let mhap = 6; mhap <= 24; mhap += 1) addSample("Uganda", mhap);

  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [{ panel_name: "p", reactions: [{ reaction_name: "r1", panel_targets: [0] }] }],
    target_info: [
      {
        target_name: "pfama1",
        forward_primer: { seq: "ACGT" },
        reverse_primer: { seq: "TGCA" },
      },
    ],
    specimen_info: specimens,
    library_sample_info: libraries,
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: [{ target_id: 0, microhaplotypes: seqs.map((seq) => ({ seq })) }],
    },
    detected_microhaplotypes: [{ bioinformatics_run_id: 0, library_samples: detections }],
  };
}

/** Measures the bar width and its containing track width inside one frequency cell. */
async function measureCellBar(
  cell: Locator,
  label: string,
): Promise<{ readonly barWidth: number; readonly trackWidth: number }> {
  const bar = cell.locator('[aria-hidden="true"]').first();
  const track = bar.locator("..");
  const [barBox, trackBox] = await Promise.all([
    requireBox(bar, `${label} bar`),
    requireBox(track, `${label} track`),
  ]);
  return { barWidth: barBox.width, trackWidth: trackBox.width };
}

/** Verifies that a wide table scrolls horizontally while keeping its first column pinned. */
async function expectStickyFirstColumn(options: {
  readonly region: Locator;
  readonly name: string;
  readonly bodyCellSelector: "td" | "th";
}): Promise<void> {
  const { region, name, bodyCellSelector } = options;
  await region.scrollIntoViewIfNeeded();
  const metrics = await region.evaluate((el) => ({
    clientWidth: el.clientWidth,
    scrollWidth: el.scrollWidth,
  }));
  expect(metrics.scrollWidth, `${name} scrolls sideways`).toBeGreaterThan(
    metrics.clientWidth + 100,
  );

  const firstHeader = region.locator("thead th").first();
  const firstBodyCell = region.locator("tbody tr").first().locator(bodyCellSelector).first();
  const secondHeader = region.locator("thead th").nth(1);
  const secondHeaderBefore = await requireBox(secondHeader, `${name} second header before`);

  await region.evaluate((el) => {
    el.scrollLeft = 500;
  });
  await expect.poll(() => region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);

  const [regionBox, firstHeaderAfter, firstCellAfter, secondHeaderAfter] = await Promise.all([
    requireBox(region, `${name} region`),
    requireBox(firstHeader, `${name} first header after scroll`),
    requireBox(firstBodyCell, `${name} first cell after scroll`),
    requireBox(secondHeader, `${name} second header after scroll`),
  ]);

  expect(Math.abs(firstHeaderAfter.x - regionBox.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(firstCellAfter.x - regionBox.x)).toBeLessThanOrEqual(2);
  expect(secondHeaderAfter.x).toBeLessThan(secondHeaderBefore.x - 100);
}

test("grouped by collection month at 1280 px, the first column stays pinned in both wide Compare tables and bars fill their tracks", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openBuiltExample({ page, tab: "compare" });

  await expect(page.getByRole("heading", { name: "Heterozygosity by target" })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  // Switch grouping to Collection month so both tables are wide and scroll sideways.
  const groupSelect = page.getByRole("combobox", { name: "Group specimens by" });
  await groupSelect.click();
  await page.getByRole("option", { name: /^Collection month\b/ }).click();

  const hetRegion = page.getByRole("region", { name: "Heterozygosity by target" });
  const alleleRegion = page.getByRole("region", { name: "Microhaplotype frequencies by group" });
  await expect(hetRegion).toBeVisible({ timeout: BUILD_TIMEOUT });
  await expect(alleleRegion).toBeVisible({ timeout: BUILD_TIMEOUT });

  // Wait until the month columns (e.g. 2015-05) have loaded.
  await expect(hetRegion.getByRole("columnheader", { name: /2015-05/ })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });

  // 1. Heterozygosity by target: horizontal scroll keeps Target column pinned on the left.
  await expectStickyFirstColumn({
    region: hetRegion,
    name: "heterozygosity table",
    bodyCellSelector: "td",
  });

  // 2. Microhaplotypes by group: horizontal scroll keeps Microhaplotype column pinned on the left.
  await expectStickyFirstColumn({
    region: alleleRegion,
    name: "microhaplotypes table",
    bodyCellSelector: "th",
  });

  // Scroll back to start and verify the largest bar fills its track.
  await alleleRegion.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const barRatios = await alleleRegion.evaluate((el) => {
    const bars = [...el.querySelectorAll<HTMLElement>('tbody td [aria-hidden="true"]')];
    return bars.map((bar) => {
      const barRect = bar.getBoundingClientRect();
      const trackRect = bar.parentElement?.getBoundingClientRect();
      return {
        barWidth: barRect.width,
        trackWidth: trackRect?.width ?? 0,
      };
    });
  });
  expect(barRatios.length).toBeGreaterThan(0);
  const maxRatio = Math.max(
    ...barRatios.map((item) => (item.trackWidth > 0 ? item.barWidth / item.trackWidth : 0)),
  );
  expect(maxRatio, "largest share fills its track").toBeGreaterThanOrEqual(0.98);
});

test("scales cell-filling bars proportionally and keeps the heading row sticky on vertical scroll", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openSyntheticPmo({
    page,
    fileName: "many-alleles.json",
    pmo: manyAllelesPmo(),
    tab: "compare",
  });

  const alleleRegion = page.getByRole("region", { name: "Microhaplotype frequencies by group" });
  await expect(alleleRegion).toBeVisible({ timeout: BUILD_TIMEOUT });
  await alleleRegion.scrollIntoViewIfNeeded();

  // Capped at 20 rows with cut-off line reporting the 5 rarer microhaplotypes not shown.
  await expect(alleleRegion.locator("tbody tr")).toHaveCount(20);
  await expect(page.getByText("5 rarer microhaplotypes are not shown.")).toBeVisible();

  // Check proportional cell-filling bars: 50% (row 0, Kenya) fills its track,
  // 25% (row 1, Kenya) is half of it, and 10% (row 2, Kenya) is one-fifth of it.
  const rows = alleleRegion.locator("tbody tr");
  const topCell = rows.nth(0).locator("td").first();
  const halfCell = rows.nth(1).locator("td").first();
  const tenthCell = rows.nth(2).locator("td").first();

  await expect(topCell).toContainText("50%");
  await expect(halfCell).toContainText("25%");
  await expect(tenthCell).toContainText("10%");

  const [top, half, tenth] = await Promise.all([
    measureCellBar(topCell, "50% cell"),
    measureCellBar(halfCell, "25% cell"),
    measureCellBar(tenthCell, "10% cell"),
  ]);

  expect(top.trackWidth, "wide cell gives bar room to breathe").toBeGreaterThan(150);
  expect(Math.abs(top.barWidth - top.trackWidth), "largest share fills track").toBeLessThanOrEqual(
    1,
  );
  expect(
    Math.abs(half.barWidth - top.barWidth * 0.5),
    "25% bar is half of 50% bar",
  ).toBeLessThanOrEqual(2);
  expect(
    Math.abs(tenth.barWidth - top.barWidth * 0.2),
    "10% bar is one-fifth of 50% bar",
  ).toBeLessThanOrEqual(2);

  // Scrolling vertically inside Microhaplotypes by group keeps its heading row pinned at top.
  const scrollMetrics = await alleleRegion.evaluate((el) => ({
    clientHeight: el.clientHeight,
    scrollHeight: el.scrollHeight,
  }));
  expect(scrollMetrics.scrollHeight, "table scrolls vertically inside its box").toBeGreaterThan(
    scrollMetrics.clientHeight + 50,
  );

  const firstBodyRow = rows.first();
  const firstBodyRowBefore = await requireBox(
    firstBodyRow,
    "first body row before vertical scroll",
  );

  await alleleRegion.evaluate((el) => {
    el.scrollTop = 200;
  });
  await expect.poll(() => alleleRegion.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);

  const [regionBox, cornerHeaderAfter, groupHeaderAfter, firstBodyRowAfter] = await Promise.all([
    requireBox(alleleRegion, "allele region"),
    requireBox(alleleRegion.locator("thead th").first(), "corner header after vertical scroll"),
    requireBox(alleleRegion.locator("thead th").nth(1), "group header after vertical scroll"),
    requireBox(firstBodyRow, "first body row after vertical scroll"),
  ]);

  expect(Math.abs(cornerHeaderAfter.y - regionBox.y)).toBeLessThanOrEqual(2);
  expect(Math.abs(groupHeaderAfter.y - regionBox.y)).toBeLessThanOrEqual(2);
  expect(firstBodyRowAfter.y).toBeLessThan(firstBodyRowBefore.y - 100);
});
