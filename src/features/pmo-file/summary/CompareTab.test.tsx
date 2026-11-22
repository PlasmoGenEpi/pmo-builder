import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { resetThemeForTests, setThemePreference } from "@/app/theme";
import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { CompareTab } from "./CompareTab";

beforeAll(() => {
  installDomPolyfills();
});

function stubMatchMedia(reducedMotion: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn<(query: string) => MediaQueryList>((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && reducedMotion,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })),
  });
}

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

async function openAndRenderCompare(
  pmo: PortableMicrohaplotypeObject,
  options?: { readonly minReads?: number | null },
) {
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
      minReads={options?.minReads ?? null}
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

/** Builds a valid PMO with two countries having the requested number of samples with data. */
function twoGroupPmo(counts: readonly [number, number]): PortableMicrohaplotypeObject {
  const base = richPmo();
  const countries = ["Kenya", "Uganda"] as const;
  const specimens: PortableMicrohaplotypeObject["specimen_info"] = [];
  const libraries: PortableMicrohaplotypeObject["library_sample_info"] = [];
  const detections: NonNullable<
    PortableMicrohaplotypeObject["detected_microhaplotypes"][number]["library_samples"]
  > = [];

  for (const [countryIndex, count] of counts.entries()) {
    const country = countries[countryIndex];
    if (country === undefined) continue;
    for (let i = 0; i < count; i += 1) {
      const id = specimens.length;
      specimens.push({
        specimen_name: `${country}_${i + 1}`,
        collection_country: country,
      });
      libraries.push({
        library_sample_name: `LIB_${id + 1}`,
        specimen_id: id,
        panel_id: 0,
      });
      detections.push({
        library_sample_id: id,
        target_results: [
          {
            mhaps_target_id: 0,
            mhaps: [{ mhap_id: i % 2, reads: 50 }],
          },
        ],
      });
    }
  }

  return {
    ...base,
    specimen_info: specimens,
    library_sample_info: libraries,
    detected_microhaplotypes: [{ bioinformatics_run_id: 0, library_samples: detections }],
    read_counts_by_stage: [],
  };
}

describe("CompareTab: group sizes and small-group marks", () => {
  it("shows each group's number of samples with data in both the heterozygosity and microhaplotype headings", async () => {
    await openAndRenderCompare(buildExamplePmo());
    const expectedSizes: readonly (readonly [string, number])[] = [
      ["2015", 5],
      ["2016", 9],
      ["2017", 14],
      ["2018", 13],
      ["2019", 8],
    ];

    const heTable = await screen.findByRole("table", { name: "Heterozygosity by target" });
    const alleleTable = screen.getByRole("table", { name: "Microhaplotype frequencies by group" });

    for (const table of [heTable, alleleTable]) {
      for (const [year, count] of expectedSizes) {
        const header = within(table).getByRole("columnheader", {
          name: new RegExp(`${year}.*${count} samples with data`),
        });
        expect(header).toHaveTextContent(`n = ${count}`);
      }
    }
  });

  it("marks groups with fewer than 10 samples with data and explains the mark above the tables", async () => {
    await openAndRenderCompare(buildExamplePmo());
    const groupsTable = await screen.findByRole("table", { name: "Groups" });
    const heTable = screen.getByRole("table", { name: "Heterozygosity by target" });
    const alleleTable = screen.getByRole("table", { name: "Microhaplotype frequencies by group" });

    // A line above the tables says what the small-group mark means.
    const note = screen.getByText(/fewer than 10 samples with data/i, { selector: "p, p *" });
    expect(
      note.compareDocumentPosition(groupsTable) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const smallYears = ["2015", "2016", "2019"];
    const largerYears = ["2017", "2018"];

    for (const table of [heTable, alleleTable]) {
      for (const year of smallYears) {
        const header = within(table).getByRole("columnheader", {
          name: new RegExp(`${year}.*Small group \\(fewer than 10 samples with data\\)`),
        });
        expect(header).toBeInTheDocument();
      }
      for (const year of largerYears) {
        const header = within(table).getByRole("columnheader", { name: new RegExp(`^${year}\\b`) });
        expect(header).not.toHaveAccessibleName(/Small group/i);
      }
    }

    // Small groups are also marked in the Groups table.
    const groupRows = within(groupsTable).getAllByRole("row").slice(1);
    for (const year of smallYears) {
      const row = groupRows.find((candidate) => candidate.textContent?.includes(year));
      expect(row).toBeDefined();
      expect(row).toHaveTextContent(/Small group \(fewer than 10 samples with data\)/);
    }
    for (const year of largerYears) {
      const row = groupRows.find((candidate) => candidate.textContent?.includes(year));
      expect(row).toBeDefined();
      expect(row).not.toHaveTextContent(/Small group/i);
    }
  });

  it("omits the small-group mark and note when every group has at least 10 samples with data", async () => {
    await openAndRenderCompare(twoGroupPmo([10, 12]));
    const heTable = await screen.findByRole("table", { name: "Heterozygosity by target" });
    const alleleTable = screen.getByRole("table", { name: "Microhaplotype frequencies by group" });

    for (const table of [heTable, alleleTable]) {
      const kenya = within(table).getByRole("columnheader", {
        name: /Kenya.*10 samples with data/,
      });
      const uganda = within(table).getByRole("columnheader", {
        name: /Uganda.*12 samples with data/,
      });
      expect(kenya).not.toHaveAccessibleName(/Small group/i);
      expect(uganda).not.toHaveAccessibleName(/Small group/i);
    }
    expect(screen.queryByText(/fewer than 10 samples with data/i)).not.toBeInTheDocument();
  });

  it("uses singular sample wording for a 1-sample group and marks it while leaving a 10-sample group unmarked", async () => {
    await openAndRenderCompare(twoGroupPmo([1, 10]));
    const heTable = await screen.findByRole("table", { name: "Heterozygosity by target" });

    const kenya = within(heTable).getByRole("columnheader", {
      name: /Kenya.*1 sample with data.*Small group \(fewer than 10 samples with data\)/,
    });
    expect(kenya).toHaveTextContent("n = 1");

    const uganda = within(heTable).getByRole("columnheader", {
      name: /Uganda.*10 samples with data/,
    });
    expect(uganda).toHaveTextContent("n = 10");
    expect(uganda).not.toHaveAccessibleName(/Small group/i);
  });

  it("explains Alleles seen in the Groups section", async () => {
    await openAndRenderCompare(buildExamplePmo());
    const heading = await screen.findByRole("heading", { name: "Groups" });
    const section = heading.closest("section");
    if (section === null) throw new Error("Expected Groups heading inside a section");
    expect(
      within(section).getByText(
        /Alleles seen is the number of distinct alleles found in the group across targets\./,
      ),
    ).toBeInTheDocument();
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

describe("CompareTab: choosing a target and jumping back", () => {
  afterEach(() => {
    stubMatchMedia(false);
    vi.restoreAllMocks();
  });

  it("choosing a target in Heterozygosity by target shows its microhaplotypes, scrolls smoothly, and focuses the heading", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const hetTable = await screen.findByRole("table", { name: "Heterozygosity by target" });
    const allelesHeading = screen.getByRole("heading", { name: "Microhaplotypes by group" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    allelesHeading.scrollIntoView = scrollIntoView;

    await user.click(within(hetTable).getByRole("button", { name: "t2" }));

    expect(screen.getByRole("combobox", { name: "Target" })).toHaveValue("t2");
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(allelesHeading).toHaveFocus();
  });

  it("moves without animation when prefers-reduced-motion is set", async () => {
    stubMatchMedia(true);
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const hetTable = await screen.findByRole("table", { name: "Heterozygosity by target" });
    const allelesHeading = screen.getByRole("heading", { name: "Microhaplotypes by group" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    allelesHeading.scrollIntoView = scrollIntoView;

    await user.click(within(hetTable).getByRole("button", { name: "t2" }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
    expect(allelesHeading).toHaveFocus();
  });

  it("does not jump when choosing a target with the combobox inside Microhaplotypes by group", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const allelesHeading = await screen.findByRole("heading", { name: "Microhaplotypes by group" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    allelesHeading.scrollIntoView = scrollIntoView;

    const combobox = screen.getByRole("combobox", { name: "Target" });
    await user.click(combobox);
    await user.click(screen.getByRole("option", { name: "t2" }));

    expect(combobox).toHaveValue("t2");
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(allelesHeading).not.toHaveFocus();
  });

  it("offers a Back to heterozygosity action that moves back to the heterozygosity heading", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const hetHeading = await screen.findByRole("heading", { name: "Heterozygosity by target" });
    const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
    hetHeading.scrollIntoView = scrollIntoView;

    const backButton = screen.getByRole("button", { name: "Back to heterozygosity" });
    backButton.focus();
    await user.keyboard("{Enter}");

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(hetHeading).toHaveFocus();
  });
});

/** Builds a valid PMO with grouping fields (`geo_admin1`) but no collection dates. */
function undatedPmo(): PortableMicrohaplotypeObject {
  const base = richPmo();
  return {
    ...base,
    specimen_info: base.specimen_info.map(({ collection_date: _dropped, ...specimen }) => specimen),
  };
}

describe("CompareTab: jump links and compact toolbar", () => {
  afterEach(() => {
    stubMatchMedia(false);
    vi.restoreAllMocks();
  });

  it("provides keyboard-accessible jump links to Groups, Heterozygosity, Microhaplotypes and Collection timeline", async () => {
    stubMatchMedia(false);
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const nav = await screen.findByRole("navigation", { name: "On this page" });
    const sections = [
      ["Groups", "Groups"],
      ["Heterozygosity by target", "Heterozygosity by target"],
      ["Microhaplotypes by group", "Microhaplotypes by group"],
      ["Collection timeline", "When specimens were collected"],
    ] as const;

    for (const [linkName, headingName] of sections) {
      const heading = screen.getByRole("heading", { name: headingName });
      const scrollIntoView = vi.fn<(arg?: boolean | ScrollIntoViewOptions) => void>();
      heading.scrollIntoView = scrollIntoView;

      const jumpButton = within(nav).getByRole("button", { name: linkName });
      jumpButton.focus();
      // oxlint-disable-next-line no-await-in-loop -- sequential keyboard navigation check.
      await user.keyboard("{Enter}");

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      expect(heading).toHaveFocus();
    }
  });

  it("omits the Collection timeline jump link when no specimens have collection dates", async () => {
    await openAndRenderCompare(undatedPmo());

    const nav = await screen.findByRole("navigation", { name: "On this page" });
    expect(within(nav).getByRole("button", { name: "Groups" })).toBeVisible();
    expect(within(nav).getByRole("button", { name: "Heterozygosity by target" })).toBeVisible();
    expect(within(nav).getByRole("button", { name: "Microhaplotypes by group" })).toBeVisible();
    expect(within(nav).queryByRole("button", { name: "Collection timeline" })).toBeNull();
  });

  it("omits jump links when minimum reads filters out all targets", async () => {
    await openAndRenderCompare(richPmo(), { minReads: 5000 });

    await screen.findByText(/No microhaplotype has at least 5,000 reads/);
    expect(screen.queryByRole("navigation", { name: "On this page" })).toBeNull();
  });

  it("uses matching compact control heights and keeps toolbar controls mounted when switching fields", async () => {
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const groupSelect = await screen.findByRole("combobox", { name: "Group specimens by" });
    const minReadsInput = screen.getByRole("textbox", {
      name: "Minimum reads per microhaplotype",
    });
    expect(groupSelect).toHaveClass("h-control-sm", "text-sm");
    expect(minReadsInput).toHaveClass("h-control-sm", "text-sm");

    await user.click(groupSelect);
    await user.click(await screen.findByRole("option", { name: /Administrative area, level 1/ }));

    await screen.findByRole("heading", { name: "Groups" });
    expect(groupSelect.isConnected).toBe(true);
    expect(minReadsInput.isConnected).toBe(true);
    expect(screen.getByRole("combobox", { name: "Group specimens by" })).toBe(groupSelect);
  });
});
