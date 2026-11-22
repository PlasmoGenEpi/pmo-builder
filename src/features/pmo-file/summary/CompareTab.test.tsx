import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { afterEach, describe, expect, it } from "vitest";

import { resetThemeForTests, setThemePreference } from "@/app/theme";
import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";

import { CompareTab } from "./CompareTab";

/** Builds a valid PMO with `peak` specimens in 2019-01 and 1 specimen in 2019-03. */
function skewedTimelinePmo(peak: number): PortableMicrohaplotypeObject {
  const base = richPmo();
  const extraSpecimens = Array.from({ length: peak - 1 }, (_, index) => ({
    specimen_name: `extra_spec_${index + 1}`,
    collection_country: "Mozambique",
    geo_admin1: "Maputo",
    collection_date: "2019-01-20",
    project_id: 0,
  }));
  const extraLibraries = extraSpecimens.map((_, index) => ({
    library_sample_name: `EXTRA_${index + 1}`,
    specimen_id: base.specimen_info.length + index,
    panel_id: 0,
  }));
  return {
    ...base,
    specimen_info: [...base.specimen_info, ...extraSpecimens],
    library_sample_info: [...base.library_sample_info, ...extraLibraries],
  };
}

interface BarBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly reversedHorizontal: boolean;
}

/**
 * Traces the vertices and quadratic control points of an SVG bar path
 * (`M`, `L`, `H`, `V`, `Q`, `Z` and relative variants) to find its bounds
 * and whether any top horizontal span goes backwards.
 */
function tracePathBounds(d: string): BarBounds {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  let i = 0;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let reversedHorizontal = false;
  const record = (px: number, py: number) => {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  };
  const nextNum = (): number => {
    const value = Number(tokens[i]);
    i += 1;
    return value;
  };
  while (i < tokens.length) {
    const cmd = tokens[i];
    i += 1;
    if (cmd === "M") {
      x = nextNum();
      y = nextNum();
      startX = x;
      startY = y;
      record(x, y);
    } else if (cmd === "L") {
      x = nextNum();
      y = nextNum();
      record(x, y);
    } else if (cmd === "H") {
      const next = nextNum();
      if (next < x) reversedHorizontal = true;
      x = next;
      record(x, y);
    } else if (cmd === "h") {
      const dx = nextNum();
      if (dx < 0) reversedHorizontal = true;
      x += dx;
      record(x, y);
    } else if (cmd === "V") {
      y = nextNum();
      record(x, y);
    } else if (cmd === "v") {
      y += nextNum();
      record(x, y);
    } else if (cmd === "Q") {
      const cx = nextNum();
      const cy = nextNum();
      x = nextNum();
      y = nextNum();
      record(cx, cy);
      record(x, y);
    } else if (cmd === "q") {
      const cx = x + nextNum();
      const cy = y + nextNum();
      x += nextNum();
      y += nextNum();
      record(cx, cy);
      record(x, y);
    } else if (cmd === "z" || cmd === "Z") {
      x = startX;
      y = startY;
    }
  }
  return { minX, maxX, minY, maxY, reversedHorizontal };
}

/** Extracts bounds for each visible bar shape drawn inside the timeline SVG. */
function readTimelineBars(svg: SVGSVGElement): {
  readonly axisY: number;
  readonly bars: readonly BarBounds[];
} {
  const axis = svg.querySelector("line");
  if (axis === null) throw new Error("Expected an axis line in the timeline SVG");
  const axisY = Number(axis.getAttribute("y1"));
  const bars: BarBounds[] = [];
  for (const element of svg.querySelectorAll("g > path, g > rect")) {
    if (element.getAttribute("fill") === "transparent") continue;
    if (element.tagName.toLowerCase() === "path") {
      bars.push(tracePathBounds(element.getAttribute("d") ?? ""));
    } else {
      const x = Number(element.getAttribute("x"));
      const y = Number(element.getAttribute("y"));
      const width = Number(element.getAttribute("width"));
      const height = Number(element.getAttribute("height"));
      bars.push({
        minX: x,
        maxX: x + width,
        minY: y,
        maxY: y + height,
        reversedHorizontal: width < 0,
      });
    }
  }
  return { axisY, bars };
}

async function openAndRenderCompare(pmo: PortableMicrohaplotypeObject) {
  const store = createTestStore();
  await store.getState().actions.initialise();
  const file = new File([stringifyPmo(pmo)], "study.json", { type: "application/json" });
  const outcome = await workingPmoSessionOf(store).open({
    kind: "file",
    file,
    name: file.name,
    origin: { kind: "chosen" },
  });
  if (outcome.kind !== "opened") throw new Error(`Could not open test PMO: ${outcome.kind}`);
  return renderWithStore(
    <CompareTab
      source="original"
      minReads={null}
      maxReads={null}
      onMinReadsChange={() => undefined}
    />,
    { store },
  );
}

describe("CompareTab: collection timeline short bars", () => {
  it("draws a 1-specimen month as a small bar strictly above the axis when another month exceeds 40", async () => {
    await openAndRenderCompare(skewedTimelinePmo(45));
    const timeline = await screen.findByRole("region", { name: "When specimens were collected" });
    const svg = timeline.querySelector("svg");
    if (svg === null) throw new Error("Expected a timeline SVG");
    const { axisY, bars } = readTimelineBars(svg);
    expect(bars).toHaveLength(2);
    const [tallBar, shortBar] = bars;
    if (tallBar === undefined || shortBar === undefined) throw new Error("Missing bars");

    // Both bars must sit strictly on/above the axis with positive width and no inverted segments.
    for (const bar of bars) {
      expect(bar.maxY).toBeLessThanOrEqual(axisY + 0.001);
      expect(bar.minY).toBeLessThan(axisY);
      expect(bar.maxX).toBeGreaterThan(bar.minX);
      expect(bar.reversedHorizontal).toBe(false);
    }

    // The 1-specimen bar is visibly present above the axis and shorter than the 45-specimen bar.
    const tallHeight = axisY - tallBar.minY;
    const shortHeight = axisY - shortBar.minY;
    expect(shortHeight).toBeGreaterThanOrEqual(1);
    expect(shortHeight).toBeLessThan(tallHeight / 4);
  });

  it("keeps a 1-specimen bar visibly above the axis even when the peak month has 200 specimens", async () => {
    await openAndRenderCompare(skewedTimelinePmo(200));
    const timeline = await screen.findByRole("region", { name: "When specimens were collected" });
    const svg = timeline.querySelector("svg");
    if (svg === null) throw new Error("Expected a timeline SVG");
    const { axisY, bars } = readTimelineBars(svg);
    expect(bars).toHaveLength(2);
    const [, shortBar] = bars;
    if (shortBar === undefined) throw new Error("Missing short bar");

    expect(shortBar.maxY).toBeLessThanOrEqual(axisY + 0.001);
    expect(axisY - shortBar.minY).toBeGreaterThanOrEqual(2);
    expect(shortBar.reversedHorizontal).toBe(false);
  });

  it("labels the last collection month on the example data timeline", async () => {
    await openAndRenderCompare(buildExamplePmo());
    const timeline = await screen.findByRole("region", { name: "When specimens were collected" });
    const labels = [...timeline.querySelectorAll("svg text")].map((node) => node.textContent);
    expect(labels).toContain("2015-05");
    expect(labels).toContain("2019-08");
  });
});

/**
 * Builds a PMO with two countries (Kenya, Mozambique) and two targets (t1, t2):
 * - t1 has 3 equal alleles in Kenya (He = 0.67) and 1 allele in Mozambique (He = 0).
 * - t2 has 1 allele in Kenya (He = 0) and no data in Mozambique (dash).
 */
function heterozygosityPmo(): PortableMicrohaplotypeObject {
  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [{ panel_name: "p", reactions: [{ reaction_name: "r1", panel_targets: [0, 1] }] }],
    target_info: ["t1", "t2"].map((target_name) => ({
      target_name,
      forward_primer: { seq: "ACGT" },
      reverse_primer: { seq: "TGCA" },
    })),
    specimen_info: [
      { specimen_name: "k1", collection_country: "Kenya" },
      { specimen_name: "k2", collection_country: "Kenya" },
      { specimen_name: "k3", collection_country: "Kenya" },
      { specimen_name: "m1", collection_country: "Mozambique" },
    ],
    library_sample_info: [
      { library_sample_name: "K1", specimen_id: 0, panel_id: 0 },
      { library_sample_name: "K2", specimen_id: 1, panel_id: 0 },
      { library_sample_name: "K3", specimen_id: 2, panel_id: 0 },
      { library_sample_name: "M1", specimen_id: 3, panel_id: 0 },
    ],
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: [
        { target_id: 0, microhaplotypes: [{ seq: "AAAA" }, { seq: "AAAT" }, { seq: "AAAG" }] },
        { target_id: 1, microhaplotypes: [{ seq: "CCCC" }] },
      ],
    },
    detected_microhaplotypes: [
      {
        bioinformatics_run_id: 0,
        library_samples: [
          {
            library_sample_id: 0,
            target_results: [
              { mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 50 }] },
              { mhaps_target_id: 1, mhaps: [{ mhap_id: 0, reads: 50 }] },
            ],
          },
          {
            library_sample_id: 1,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 1, reads: 50 }] }],
          },
          {
            library_sample_id: 2,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 2, reads: 50 }] }],
          },
          {
            library_sample_id: 3,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 50 }] }],
          },
        ],
      },
    ],
  };
}

function rgbLuminance(rgb: string): number {
  const match = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/.exec(rgb);
  if (match === null) throw new Error(`Expected rgb(...) colour, got "${rgb}"`);
  const channels = [Number(match[1]), Number(match[2]), Number(match[3])].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrastAgainstHex(rgb: string, hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  const textRgb = `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
  const a = rgbLuminance(rgb);
  const b = rgbLuminance(textRgb);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function cellFor(table: HTMLElement, targetName: string, columnIndex: number): HTMLElement {
  const row = within(table)
    .getAllByRole("row")
    .slice(1)
    .find((candidate) => within(candidate).queryByRole("button", { name: targetName }) !== null);
  if (row === undefined) throw new Error(`Missing row for ${targetName}`);
  const cell = within(row).getAllByRole("cell")[columnIndex];
  if (cell === undefined) throw new Error(`Missing cell ${columnIndex} for ${targetName}`);
  return cell;
}

describe("CompareTab: heterozygosity table shading", () => {
  afterEach(() => {
    setThemePreference("light");
    resetThemeForTests();
  });

  it.each([
    { theme: "light" as const, textHex: "#171a21" },
    { theme: "dark" as const, textHex: "#eceef2" },
  ])(
    "shades valued cells monotonically with WCAG AA contrast and leaves dash cells unshaded in the $theme theme",
    async ({ theme, textHex }) => {
      setThemePreference(theme);
      await openAndRenderCompare(heterozygosityPmo());

      const table = await screen.findByRole("table", { name: "Heterozygosity by target" });
      // Column 1 is Kenya (3 specimens, sorted first), column 2 is Mozambique (1 specimen).
      const highCell = cellFor(table, "t1", 1);
      const zeroCell = cellFor(table, "t1", 2);
      const dashCell = cellFor(table, "t2", 2);

      // Numbers remain visible on top of the shading, and missing values stay a dash without shading.
      expect(highCell).toHaveTextContent("0.67");
      expect(zeroCell).toHaveTextContent("0");
      expect(dashCell).toHaveTextContent("–");
      expect(dashCell.style.backgroundColor).toBe("");

      // Valued cells are shaded and pass WCAG AA (>= 4.5:1) against body text.
      expect(highCell.style.backgroundColor).not.toBe("");
      expect(zeroCell.style.backgroundColor).not.toBe("");
      expect(contrastAgainstHex(highCell.style.backgroundColor, textHex)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastAgainstHex(zeroCell.style.backgroundColor, textHex)).toBeGreaterThanOrEqual(
        4.5,
      );

      // Higher heterozygosity is visibly stronger than 0 (darker in light, brighter in dark).
      const highLum = rgbLuminance(highCell.style.backgroundColor);
      const zeroLum = rgbLuminance(zeroCell.style.backgroundColor);
      const direction = theme === "light" ? -1 : 1;
      expect((highLum - zeroLum) * direction).toBeGreaterThan(0);
    },
  );

  it("shows a legend for the 0 to 1 scale and unshaded dashes, and keeps the chosen row marked", async () => {
    const user = userEvent.setup();
    await openAndRenderCompare(heterozygosityPmo());

    const table = await screen.findByRole("table", { name: "Heterozygosity by target" });
    const section = table.closest("section")?.parentElement;
    if (section === null || section === undefined) throw new Error("Expected section wrapper");

    // Legend under the table explains the 0 to 1 scale and unshaded missing cells.
    expect(within(section).getByText(/Expected heterozygosity \(0 to 1\)/i)).toBeInTheDocument();
    expect(within(section).getByText(/No value \(unshaded\)/i)).toBeInTheDocument();

    // t1 has more alleles so it starts chosen; clicking t2 moves the chosen-row mark.
    const t1Button = within(table).getByRole("button", { name: "t1", pressed: true });
    expect(t1Button.closest("tr")).toHaveAttribute("data-selected", "true");

    await user.click(within(table).getByRole("button", { name: "t2" }));
    const t2Button = within(table).getByRole("button", { name: "t2", pressed: true });
    expect(t2Button.closest("tr")).toHaveAttribute("data-selected", "true");
    expect(t1Button.closest("tr")).not.toHaveAttribute("data-selected");
  });
});
