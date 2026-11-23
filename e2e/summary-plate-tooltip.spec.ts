/**
 * Plate well tooltip placement on the Summary tab against the production build:
 * hovering a well shows the sample name and target count next to the well,
 * inside the plate's area, and keeps the details inside the viewport for wells
 * in the last row and last column.
 */
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures/privacy";
import {
  boxDistance,
  expectInsideViewport,
  openBuiltExample,
  openSyntheticPmo,
  requireBox,
} from "./support/pmoFile";
import { BUILD_TIMEOUT } from "./support/review";

/** Opens the built example on the Summary tab and returns the Plates section. */
async function openExamplePlates(page: Page): Promise<Locator> {
  await openBuiltExample({ page, tab: "summary" });
  const plates = page.locator("section", {
    has: page.getByRole("heading", { name: "Plates", exact: true }),
  });
  await expect(plates).toBeVisible({ timeout: BUILD_TIMEOUT });
  return plates;
}

/**
 * A valid PMO with samples placed in the four corners of a 96-well plate
 * (including row H, column 12) plus extra rows so the Plates section sits
 * below the fold.
 */
function cornerWellsPmo(): Record<string, unknown> {
  const placements: readonly {
    readonly name: string;
    readonly row: string;
    readonly col: number;
  }[] = [
    { name: "corner_a1", row: "A", col: 1 },
    { name: "corner_a12", row: "A", col: 12 },
    { name: "corner_h1", row: "H", col: 1 },
    { name: "corner_h12", row: "H", col: 12 },
    { name: "filler_b2", row: "B", col: 2 },
    { name: "filler_c3", row: "C", col: 3 },
    { name: "filler_d4", row: "D", col: 4 },
    { name: "filler_e5", row: "E", col: 5 },
    { name: "filler_f6", row: "F", col: 6 },
    { name: "filler_g7", row: "G", col: 7 },
  ];
  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [
      {
        panel_name: "p1",
        reactions: [{ reaction_name: "pool1", panel_targets: [0, 1] }],
      },
    ],
    target_info: ["t1", "t2"].map((target_name) => ({
      target_name,
      forward_primer: { seq: "ACGT" },
      reverse_primer: { seq: "TGCA" },
    })),
    specimen_info: placements.map((entry) => ({
      specimen_name: `spec_${entry.name}`,
      collection_country: "Mozambique",
      collection_date: "2024-01",
    })),
    library_sample_info: placements.map((entry, index) => ({
      library_sample_name: entry.name,
      specimen_id: index,
      panel_id: 0,
      library_prep_plate_info: {
        plate_name: "Plate 1",
        plate_row: entry.row,
        plate_col: entry.col,
      },
    })),
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: [
        { target_id: 0, microhaplotypes: [{ seq: "AAAA" }] },
        { target_id: 1, microhaplotypes: [{ seq: "CCCC" }] },
      ],
    },
    detected_microhaplotypes: [
      {
        bioinformatics_run_id: 0,
        library_samples: placements.map((_, index) => ({
          library_sample_id: index,
          target_results: [
            { mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 80 }] },
            { mhaps_target_id: 1, mhaps: [{ mhap_id: 0, reads: 40 }] },
          ],
        })),
      },
    ],
  };
}

test("hovering well A1 on the example plate shows its details beside the well within the plate area", async ({
  page,
}) => {
  const viewport = { width: 1280, height: 720 };
  await page.setViewportSize(viewport);
  const plates = await openExamplePlates(page);

  const plateSvg = plates.locator("figure svg").first();
  await plateSvg.scrollIntoViewIfNeeded();

  // Well A1 is row 0, column 0 in the 8x12 grid.
  const wellA1 = plateSvg.locator("rect").nth(0);
  await wellA1.hover();

  const tooltip = plates.getByText("example_sample_01", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/\d+ targets? with data/);

  const plateBox = await requireBox(plateSvg, "plate");
  const wellBox = await requireBox(wellA1, "well A1");
  const tooltipBox = await requireBox(tooltip, "tooltip");

  expect(
    boxDistance(wellBox, tooltipBox),
    "distance between well A1 and tooltip",
  ).toBeLessThanOrEqual(24);
  expect(tooltipBox.x, "tooltip left inside plate").toBeGreaterThanOrEqual(plateBox.x);
  expect(tooltipBox.y, "tooltip top inside plate").toBeGreaterThanOrEqual(plateBox.y);
  expect(tooltipBox.x + tooltipBox.width, "tooltip right inside plate").toBeLessThanOrEqual(
    plateBox.x + plateBox.width,
  );
  expect(tooltipBox.y + tooltipBox.height, "tooltip bottom inside plate").toBeLessThanOrEqual(
    plateBox.y + plateBox.height,
  );
  expectInsideViewport(tooltipBox, viewport);
});

test("hovering a well in the last column keeps its details inside a narrow viewport", async ({
  page,
}) => {
  const viewport = { width: 390, height: 720 };
  await page.setViewportSize(viewport);
  const plates = await openExamplePlates(page);

  const plateSvg = plates.locator("figure svg").first();
  await plateSvg.scrollIntoViewIfNeeded();

  // Well D12 (example_sample_48) sits in the last column (column 12) of the 96-well plate.
  const wellD12 = plateSvg.locator("rect").nth(3 * 12 + 11);
  await wellD12.hover();

  const tooltip = plates.getByText("example_sample_48", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(/\d+ targets? with data/);

  const wellBox = await requireBox(wellD12, "well D12");
  const tooltipBox = await requireBox(tooltip, "tooltip");

  expectInsideViewport(tooltipBox, viewport);
  expect(
    boxDistance(wellBox, tooltipBox),
    "distance between well D12 and tooltip",
  ).toBeLessThanOrEqual(24);
});

test("hovering a well in the last row and last column keeps its details inside the viewport", async ({
  page,
}) => {
  const viewport = { width: 390, height: 600 };
  await page.setViewportSize(viewport);
  await openSyntheticPmo({
    page,
    fileName: "corner-wells.json",
    pmo: cornerWellsPmo(),
    tab: "summary",
  });

  const plates = page.locator("section", {
    has: page.getByRole("heading", { name: "Plates", exact: true }),
  });
  await expect(plates).toBeVisible({ timeout: BUILD_TIMEOUT });

  const plateSvg = plates.locator("figure svg").first();
  // Well H12 is row 7, column 11 in the 8x12 grid.
  const wellH12 = plateSvg.locator("rect").nth(7 * 12 + 11);

  // Scroll so well H12 sits near the bottom edge of the viewport, exercising both
  // the bottom-edge (last row) and right-edge (last column) bounds at once.
  await wellH12.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const targetBottom = window.innerHeight - 12;
    window.scrollBy(0, rect.bottom - targetBottom);
  });

  const wellBoxBefore = await requireBox(wellH12, "well H12");
  expect(wellBoxBefore.y + wellBoxBefore.height).toBeGreaterThan(viewport.height - 40);

  await wellH12.hover();

  const tooltip = plates.getByText("corner_h12", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("2 targets with data");

  const wellBox = await requireBox(wellH12, "well H12");
  const tooltipBox = await requireBox(tooltip, "tooltip");

  expectInsideViewport(tooltipBox, viewport);
  expect(
    boxDistance(wellBox, tooltipBox),
    "distance between well H12 and tooltip",
  ).toBeLessThanOrEqual(24);
});
