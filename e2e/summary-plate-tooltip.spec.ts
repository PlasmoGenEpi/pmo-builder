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
  expectInsideViewport(wellBoxBefore, viewport);
  expect(wellBoxBefore.y + wellBoxBefore.height).toBeGreaterThan(viewport.height - 40);

  // Hover by coordinates rather than `locator.hover()` so Playwright does not
  // auto-scroll well H12 away from the bottom edge before triggering the tooltip.
  await page.mouse.move(
    wellBoxBefore.x + wellBoxBefore.width / 2,
    wellBoxBefore.y + wellBoxBefore.height / 2,
  );

  const tooltip = plates.getByText("corner_h12", { exact: true }).locator("..");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText("2 targets with data");

  const wellBox = await requireBox(wellH12, "well H12");
  expect(wellBox.y + wellBox.height, "well H12 stays near bottom edge").toBeGreaterThan(
    viewport.height - 40,
  );
  const tooltipBox = await requireBox(tooltip, "tooltip");

  expectInsideViewport(tooltipBox, viewport);
  expect(
    tooltipBox.y + tooltipBox.height,
    "tooltip flips above well H12 near bottom edge",
  ).toBeLessThanOrEqual(wellBox.y);
  expect(
    boxDistance(wellBox, tooltipBox),
    "distance between well H12 and tooltip",
  ).toBeLessThanOrEqual(24);
});

test("plate legend shows scale, no-data and empty-well entries in light and dark themes, and filled wells open on focus and tap", async ({
  page,
}) => {
  const viewport = { width: 390, height: 720 };
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: "light" });
  const plates = await openExamplePlates(page);

  const figure = plates.locator("figure").first();
  await figure.scrollIntoViewIfNeeded();

  const legend = figure.getByRole("list", { name: "Plate legend" });
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("1");
  await expect(legend).toContainText(/\d+ targets? with data/);
  await expect(legend).toContainText("No data");
  await expect(legend).toContainText("Empty well");

  const legendBox = await requireBox(legend, "plate legend at 390 px");
  expectInsideViewport(legendBox, viewport);

  const readLegendPalette = async () =>
    legend.evaluate((list) => {
      const swatches = list.querySelectorAll<HTMLElement>('[aria-hidden="true"]');
      const ramp = swatches[0];
      const noData = swatches[1];
      return {
        rampImage: ramp ? getComputedStyle(ramp).backgroundImage : "",
        noDataBg: noData ? getComputedStyle(noData).backgroundColor : "",
      };
    });

  const lightPalette = await readLegendPalette();
  expect(lightPalette.rampImage).toContain("linear-gradient");
  expect(lightPalette.noDataBg).not.toBe("");

  // Switch to dark theme and confirm the legend updates to dark palette colours.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(legend).toBeVisible();
  await expect
    .poll(async () => (await readLegendPalette()).rampImage)
    .not.toBe(lightPalette.rampImage);
  const darkPalette = await readLegendPalette();
  expect(darkPalette.rampImage).toContain("linear-gradient");
  expect(darkPalette.noDataBg).not.toBe(lightPalette.noDataBg);

  // Keyboard focus on a filled well opens its details inside the viewport.
  const wellA1 = figure.getByRole("button", { name: /^A1, example_sample_01:/ });
  await wellA1.focus();
  await expect(wellA1).toBeFocused();
  const focusTooltip = plates.getByText("example_sample_01", { exact: true }).locator("..");
  await expect(focusTooltip).toBeVisible();
  expectInsideViewport(await requireBox(focusTooltip, "focus tooltip"), viewport);

  // Tapping/clicking a well in the last column pins its details until Escape dismisses it.
  const wellD12 = figure.getByRole("button", { name: /^D12, example_sample_48:/ });
  await wellD12.click();
  await expect(wellD12).toHaveAttribute("aria-pressed", "true");
  const tapTooltip = plates.getByText("example_sample_48", { exact: true }).locator("..");
  await expect(tapTooltip).toBeVisible();
  expectInsideViewport(await requireBox(tapTooltip, "tap tooltip"), viewport);

  await page.keyboard.press("Escape");
  await expect(wellD12).toHaveAttribute("aria-pressed", "false");
  await expect(tapTooltip).not.toBeVisible();
});
