import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";

import { resetThemeForTests, setThemePreference } from "@/app/theme";
import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import type {
  GroupComparison,
  GroupField,
  WorkingPmoAnswer,
  WorkingPmoQuery,
  WorkingPmoQueryKind,
  WorkingPmoValues,
} from "@/domain/tools/types";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import {
  PmoSessionProvider,
  workingPmoSessionOf,
  type WorkingPmoSession,
  type WorkingPmoState,
} from "@/state";
import { stubMatchMedia } from "@/test/matchMedia";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { CompareTab } from "./CompareTab";

beforeAll(() => {
  installDomPolyfills();
});

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

describe("CompareTab: microhaplotype sequences", () => {
  it("opens and copies a microhaplotype's full sequence from the table", async () => {
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());
    const table = await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });

    await user.click(within(table).getByRole("button", { name: "A4T" }));

    const dialog = screen.getByRole("dialog", { name: "Sequence for A4T" });
    expect(within(dialog).getByText("AAAT")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe("AAAT");
    expect(within(dialog).getByRole("button", { name: "Copied" })).toBeVisible();
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

  it("marks groups with fewer than 10 samples with data and explains the mark under the Groups table", async () => {
    await openAndRenderCompare(buildExamplePmo());
    const groupsTable = await screen.findByRole("table", { name: "Groups" });
    const heTable = screen.getByRole("table", { name: "Heterozygosity by target" });
    const alleleTable = screen.getByRole("table", { name: "Microhaplotype frequencies by group" });

    // A line under the Groups table, the first to carry the mark, says what it means.
    const note = screen.getByText(/fewer than 10 samples with data/i, { selector: "p, p *" });
    expect(
      groupsTable.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(note.compareDocumentPosition(heTable) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

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

function cellFor(options: {
  readonly table: HTMLElement;
  readonly targetName: string;
  readonly columnIndex: number;
}): HTMLElement {
  const { table, targetName, columnIndex } = options;
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

  it.each(["light", "dark"] as const)(
    "shades valued cells distinctly by value and leaves dash cells unshaded in the %s theme",
    async (theme) => {
      setThemePreference(theme);
      await openAndRenderCompare(heterozygosityPmo());

      const table = await screen.findByRole("table", { name: "Heterozygosity by target" });
      // Column 1 is Kenya (3 specimens, sorted first), column 2 is Mozambique (1 specimen).
      const highCell = cellFor({ table, targetName: "t1", columnIndex: 1 });
      const zeroCell = cellFor({ table, targetName: "t1", columnIndex: 2 });
      const dashCell = cellFor({ table, targetName: "t2", columnIndex: 2 });

      // Numbers remain visible on top of the shading, and missing values stay a dash without shading.
      expect(highCell).toHaveTextContent("0.67");
      expect(zeroCell).toHaveTextContent("0");
      expect(dashCell).toHaveTextContent("–");
      expect(dashCell.style.backgroundColor).toBe("");

      // Valued cells are shaded distinctly across different heterozygosity values.
      expect(highCell.style.backgroundColor).not.toBe("");
      expect(zeroCell.style.backgroundColor).not.toBe("");
      expect(highCell.style.backgroundColor).not.toBe(zeroCell.style.backgroundColor);
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

  it("keeps toolbar controls mounted when switching fields", async () => {
    const user = userEvent.setup();
    await openAndRenderCompare(richPmo());

    const groupSelect = await screen.findByRole("combobox", { name: "Group specimens by" });
    const minReadsInput = screen.getByRole("textbox", {
      name: "Minimum reads per microhaplotype",
    });

    await user.click(groupSelect);
    await user.click(await screen.findByRole("option", { name: /Administrative area, level 1/ }));

    await screen.findByRole("heading", { name: "Groups" });
    expect(groupSelect.isConnected).toBe(true);
    expect(minReadsInput.isConnected).toBe(true);
    expect(screen.getByRole("combobox", { name: "Group specimens by" })).toBe(groupSelect);
  });
});

type ComparisonHandlers = {
  readonly [P in WorkingPmoQueryKind]?: () => WorkingPmoValues[P];
};

function answerComparisonQuery<K extends WorkingPmoQueryKind>(
  handlers: ComparisonHandlers,
  request: WorkingPmoQuery<K>,
): WorkingPmoAnswer<K> {
  const respond = handlers[request.kind];
  if (respond === undefined) return { kind: "not-open" };
  return { kind: "ok", value: respond() };
}

function readBarWidth(cell: HTMLElement): string | null {
  const bar = cell.querySelector<HTMLElement>('[aria-hidden="true"]');
  return bar?.style.width ?? null;
}

/** Renders `CompareTab` backed by a fixed `GroupComparison` through `PmoSessionProvider`. */
async function renderWithComparison(options: {
  readonly fields: readonly GroupField[];
  readonly comparison: GroupComparison;
}) {
  const { fields, comparison } = options;
  const handlers: ComparisonHandlers = {
    groupFields: () => fields,
    groups: () => comparison,
  };
  const sessionState = createStore<WorkingPmoState>(() => ({
    generation: 1,
    open: { kind: "none" },
    minReads: null,
    tableFormat: "csv",
    subset: { kind: "none" },
    source: "original",
  }));
  const session: WorkingPmoSession = {
    state: sessionState,
    open: () => Promise.resolve({ kind: "failed" }),
    close: () => Promise.resolve(),
    query: <K extends WorkingPmoQueryKind>(
      request: WorkingPmoQuery<K>,
    ): Promise<WorkingPmoAnswer<K>> => Promise.resolve(answerComparisonQuery(handlers, request)),
    subset: () => Promise.resolve({ kind: "not-open" }),
    isPublishedOpen: () => false,
    setMinReads: () => undefined,
    setTableFormat: () => undefined,
    setSource: () => undefined,
  };
  return renderWithStore(
    <PmoSessionProvider session={session}>
      <CompareTab source="original" minReads={null} maxReads={null} onMinReadsChange={() => {}} />
    </PmoSessionProvider>,
  );
}

describe("CompareTab: Microhaplotypes by group readability", () => {
  it("hides microhaplotypes absent from every group shown by default and reveals them when toggled", async () => {
    const user = userEvent.setup();
    await renderWithComparison({
      fields: [{ key: "collection_country", present: 24, total: 24, distinct: 2 }],
      comparison: {
        key: "collection_country",
        groups: [
          {
            name: "Kenya",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 2,
            meanHeterozygosity: 0.5,
            alleles: 2,
          },
          {
            name: "Uganda",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 1,
            meanHeterozygosity: 0.4,
            alleles: 2,
          },
        ],
        targets: [
          {
            name: "pfama1",
            heterozygosity: [0.5, 0.4],
            alleles: [
              {
                mhapId: 0,
                seq: "AAAAAA",
                label: { label: "most common", source: "alignment", note: null },
                freqs: [0.6, 0.4],
              },
              {
                mhapId: 1,
                seq: "AAAAAT",
                label: { label: "A6T", source: "alignment", note: null },
                freqs: [0.4, 0],
              },
              {
                mhapId: 2,
                seq: "AAAAAG",
                label: { label: "A6G", source: "alignment", note: null },
                freqs: [0, 0],
              },
              {
                mhapId: 3,
                seq: "AAAAAC",
                label: { label: "A6C", source: "alignment", note: null },
                freqs: [null, 0],
              },
            ],
          },
        ],
        timeline: [],
        timelineUnit: null,
        dated: 0,
      },
    });

    const table = await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });
    // Only the two microhaplotypes present in at least one group appear by default.
    expect(within(table).getByRole("rowheader", { name: "most common" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "A6T" })).toBeInTheDocument();
    expect(within(table).queryByRole("rowheader", { name: "A6G" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("rowheader", { name: "A6C" })).not.toBeInTheDocument();

    // A switch lets the scientist show the absent microhaplotypes.
    const toggle = screen.getByRole("switch", {
      name: /Show microhaplotypes absent from every group/i,
    });
    expect(toggle).not.toBeChecked();

    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(within(table).getByRole("rowheader", { name: "A6G" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "A6C" })).toBeInTheDocument();
  });

  it("omits the absent-microhaplotypes switch when every microhaplotype appears in at least one group", async () => {
    await openAndRenderCompare(richPmo());
    await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });
    expect(
      screen.queryByRole("switch", { name: /Show microhaplotypes absent from every group/i }),
    ).not.toBeInTheDocument();
  });

  it("cuts off at 20 microhaplotypes across many groups and reveals absent rows when toggled", async () => {
    const user = userEvent.setup();
    const groupNames = ["Kenya", "Uganda", "Tanzania", "Malawi", "Mozambique", "Ghana"] as const;
    const groups = groupNames.map((name, index) => ({
      name,
      specimens: 12,
      librarySamples: 12,
      withData: 12,
      polyclonal: 2,
      meanHeterozygosity: 0.9 - index * 0.05,
      alleles: 21,
    }));
    const alleles = Array.from({ length: 23 }, (_, index) => ({
      mhapId: index,
      seq: `AAA${String(index).padStart(3, "A")}`,
      label: {
        label: index === 0 ? "most common" : `A${index + 1}T`,
        source: "alignment" as const,
        note: null,
      },
      // 21 present microhaplotypes across 6 groups + 2 absent from every group.
      freqs:
        index < 21
          ? groupNames.map((_group, groupIndex) =>
              groupIndex === 0 ? 0.05 : index === 0 ? 0.5 : 0.01,
            )
          : groupNames.map((_group, groupIndex) => (index === 22 && groupIndex === 0 ? null : 0)),
    }));

    await renderWithComparison({
      fields: [{ key: "collection_country", present: 72, total: 72, distinct: groupNames.length }],
      comparison: {
        key: "collection_country",
        groups,
        targets: [
          {
            name: "pfama1",
            heterozygosity: groupNames.map((_, index) => 0.9 - index * 0.05),
            alleles,
          },
        ],
        timeline: [],
        timelineUnit: null,
        dated: 0,
      },
    });

    const table = await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });
    // Microhaplotype column + all 6 group columns.
    expect(within(table).getAllByRole("columnheader")).toHaveLength(groupNames.length + 1);
    // Header row + 20 visible microhaplotype rows; absent rows are hidden by default.
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(screen.getByText("1 rarer microhaplotype is not shown.")).toBeInTheDocument();
    expect(within(table).queryByRole("rowheader", { name: "A22T" })).not.toBeInTheDocument();
    expect(within(table).queryByRole("rowheader", { name: "A23T" })).not.toBeInTheDocument();

    // Turning on the switch reveals all 23 rows, including the 2 absent microhaplotypes, with no cut-off note.
    await user.click(
      screen.getByRole("switch", { name: /Show microhaplotypes absent from every group/i }),
    );
    expect(within(table).getAllByRole("row")).toHaveLength(24);
    expect(within(table).getByRole("rowheader", { name: "A22T" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "A23T" })).toBeInTheDocument();
    expect(screen.queryByText(/rarer microhaplotype/i)).not.toBeInTheDocument();
  });

  it("omits the rarer-microhaplotypes cut-off line when 20 or fewer microhaplotypes are visible", async () => {
    const alleles = Array.from({ length: 20 }, (_, index) => ({
      mhapId: index,
      seq: `CCC${String(index).padStart(3, "A")}`,
      label: {
        label: index === 0 ? "most common" : `C${index + 1}G`,
        source: "alignment" as const,
        note: null,
      },
      freqs: [0.05, 0.05],
    }));

    await renderWithComparison({
      fields: [{ key: "collection_country", present: 24, total: 24, distinct: 2 }],
      comparison: {
        key: "collection_country",
        groups: [
          {
            name: "Kenya",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 2,
            meanHeterozygosity: 0.9,
            alleles: 20,
          },
          {
            name: "Uganda",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 2,
            meanHeterozygosity: 0.9,
            alleles: 20,
          },
        ],
        targets: [{ name: "pfama1", heterozygosity: [0.9, 0.9], alleles }],
        timeline: [],
        timelineUnit: null,
        dated: 0,
      },
    });

    const table = await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });
    expect(within(table).getAllByRole("row")).toHaveLength(21);
    expect(screen.queryByText(/rarer microhaplotype/i)).not.toBeInTheDocument();
  });

  it("scales each microhaplotype bar proportionally to the largest share in the table", async () => {
    await renderWithComparison({
      fields: [{ key: "collection_country", present: 24, total: 24, distinct: 2 }],
      comparison: {
        key: "collection_country",
        groups: [
          {
            name: "Kenya",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 2,
            meanHeterozygosity: 0.7,
            alleles: 2,
          },
          {
            name: "Uganda",
            specimens: 12,
            librarySamples: 12,
            withData: 12,
            polyclonal: 2,
            meanHeterozygosity: 0.7,
            alleles: 2,
          },
        ],
        targets: [
          {
            name: "pfama1",
            heterozygosity: [0.7, 0.7],
            alleles: [
              {
                mhapId: 0,
                seq: "AAAAAA",
                label: { label: "most common", source: "alignment", note: null },
                freqs: [0.5, 0.25],
              },
              {
                mhapId: 1,
                seq: "AAAAAT",
                label: { label: "A6T", source: "alignment", note: null },
                freqs: [0.1, 0],
              },
            ],
          },
        ],
        timeline: [],
        timelineUnit: null,
        dated: 0,
      },
    });

    const table = await screen.findByRole("table", { name: "Microhaplotype frequencies by group" });
    const rows = within(table).getAllByRole("row").slice(1);
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (firstRow === undefined || secondRow === undefined) throw new Error("Expected two rows");

    // Row header stays sticky and exposes the SequenceLabel trigger with full sequence in title.
    const firstHeader = within(firstRow).getByRole("rowheader");
    expect(firstHeader).toHaveTextContent("most common");
    expect(within(firstHeader).getByRole("button", { name: "most common" })).toHaveAttribute(
      "title",
      "AAAAAA",
    );

    const [kenyaTop, ugandaHalf] = within(firstRow).getAllByRole("cell");
    const [kenyaTenth, ugandaZero] = within(secondRow).getAllByRole("cell");
    if (
      kenyaTop === undefined ||
      ugandaHalf === undefined ||
      kenyaTenth === undefined ||
      ugandaZero === undefined
    ) {
      throw new Error("Expected frequency cells");
    }

    expect(kenyaTop).toHaveTextContent("50%");
    expect(ugandaHalf).toHaveTextContent("25%");
    expect(kenyaTenth).toHaveTextContent("10%");
    expect(ugandaZero).toHaveTextContent("0%");

    // Largest share (50%) fills 100% of its track; 25% is 50%, 10% is 20%, and 0% has no bar.
    expect(readBarWidth(kenyaTop)).toBe("100%");
    expect(readBarWidth(ugandaHalf)).toBe("50%");
    expect(readBarWidth(kenyaTenth)).toBe("20%");
    expect(readBarWidth(ugandaZero)).toBeNull();
  });
});
