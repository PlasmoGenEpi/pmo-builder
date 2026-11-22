import { screen } from "@testing-library/react";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it } from "vitest";

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
    <CompareTab source="original" minReads={null} onMinReadsChange={() => undefined} />,
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
