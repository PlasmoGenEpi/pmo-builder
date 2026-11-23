import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { resetThemeForTests, setThemePreference } from "@/app/theme";
import type { PmoSummary, SampleSummary } from "@/domain/tools/types";

import { ControlsCheck, DensityView, PlateView } from "./QualityViews";

function makeSample(options: {
  readonly libraryId: number;
  readonly name: string;
  readonly targets: number;
  readonly plate: SampleSummary["plate"];
  readonly run?: string;
  readonly control?: SampleSummary["control"];
  readonly density?: SampleSummary["density"];
  readonly reads?: number;
}): SampleSummary {
  return {
    libraryId: options.libraryId,
    name: options.name,
    specimen: `spec_${options.name}`,
    run: options.run ?? "run1",
    targets: options.targets,
    reads: options.reads ?? options.targets * 50,
    maxAlleles: options.targets > 0 ? 1 : 0,
    control: options.control ?? null,
    plate: options.plate,
    density: options.density ?? null,
    rawReads: null,
    stageReads: [],
  };
}

function makePlateSummary(samples: readonly SampleSummary[]): PmoSummary {
  const maxTargets = Math.max(0, ...samples.map((sample) => sample.targets));
  return {
    minReads: 0,
    librarySamples: samples.length,
    runs: 1,
    headline: {
      samplesWithData: samples.filter((sample) => sample.targets > 0).length,
      targetsWithData: maxTargets,
      medianTargets: maxTargets,
      medianReads: maxTargets * 50,
      polyclonal: 0,
    },
    samples,
    targets: Array.from({ length: maxTargets }, (_, index) => ({
      name: `target_${index + 1}`,
      samples: samples.filter((sample) => sample.targets > index).length,
      alleles: [],
      heterozygosity: null,
    })),
    reactions: [],
    stages: [],
    grid: { columns: maxTargets, reads: [], alleles: [] },
  };
}

afterEach(() => {
  setThemePreference("light");
  resetThemeForTests();
});

describe("PlateView", () => {
  it("shows a legend under each plate with the scale range, no-data mark and empty well", () => {
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 21,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
      makeSample({
        libraryId: 1,
        name: "sample_a2",
        targets: 0,
        plate: { plate: "Plate 1", row: "A", col: 2 },
      }),
      makeSample({
        libraryId: 2,
        name: "sample_b1",
        targets: 12,
        plate: { plate: "Plate 2", row: "B", col: 1 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    const figures = screen.getAllByRole("figure");
    expect(figures).toHaveLength(2);

    for (const figure of figures) {
      const legend = within(figure).getByRole("list", { name: "Plate legend" });
      expect(within(legend).getByText("1")).toBeVisible();
      expect(within(legend).getByText("21 targets with data")).toBeVisible();
      expect(within(legend).getByText("No data")).toBeVisible();
      expect(within(legend).getByText("Empty well")).toBeVisible();
    }
  });

  it("uses singular wording in the legend when the highest count is one target", () => {
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 1,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    const figure = screen.getByRole("figure");
    const legend = within(figure).getByRole("list", { name: "Plate legend" });
    expect(within(legend).getByText("1 target with data")).toBeVisible();
  });

  it("updates the legend colours when the theme changes between light and dark", () => {
    setThemePreference("light");
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 10,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    const figure = screen.getByRole("figure");
    const legend = within(figure).getByRole("list", { name: "Plate legend" });
    const noDataSwatch = within(legend)
      .getByText("No data")
      .querySelector("span[aria-hidden='true']");
    const scaleBar = within(legend)
      .getByText("10 targets with data")
      .parentElement?.querySelector("span[aria-hidden='true']");
    if (!(scaleBar instanceof HTMLElement)) {
      throw new Error("Expected legend gradient bar element");
    }

    expect(noDataSwatch).toHaveStyle({ backgroundColor: "rgb(238, 240, 243)" });
    expect(scaleBar.style.backgroundImage).toContain("rgb(205, 226, 251)");
    expect(scaleBar.style.backgroundImage).toContain("rgb(13, 54, 107)");

    act(() => {
      setThemePreference("dark");
    });

    expect(noDataSwatch).toHaveStyle({ backgroundColor: "rgb(34, 38, 45)" });
    expect(scaleBar.style.backgroundImage).toContain("rgb(16, 66, 129)");
    expect(scaleBar.style.backgroundImage).toContain("rgb(205, 226, 251)");
  });

  it("uses roving tabIndex per plate with arrow, Home and End navigation, and shows details on focus without duplicating them in the live region", () => {
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 18,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
      makeSample({
        libraryId: 1,
        name: "sample_a2",
        targets: 0,
        plate: { plate: "Plate 1", row: "A", col: 2 },
      }),
      makeSample({
        libraryId: 2,
        name: "sample_b2",
        targets: 9,
        plate: { plate: "Plate 1", row: "B", col: 2 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    // Scroll landmark is named with the Plate prefix so raw plate names cannot collide with other landmarks.
    expect(screen.getByRole("region", { name: "Plate Plate 1" })).toBeInTheDocument();

    // Only filled wells are exposed as buttons, and only the active well has tabIndex 0.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);

    const wellA1 = screen.getByRole("button", {
      name: "A1, sample_a1: 18 targets with data",
    });
    const wellA2 = screen.getByRole("button", {
      name: "A2, sample_a2: 0 targets with data",
    });
    const wellB2 = screen.getByRole("button", {
      name: "B2, sample_b2: 9 targets with data",
    });
    expect(wellA1).toHaveAttribute("tabindex", "0");
    expect(wellA1).toHaveAttribute("aria-pressed", "false");
    expect(wellA2).toHaveAttribute("tabindex", "-1");
    expect(wellB2).toHaveAttribute("tabindex", "-1");

    // Focusing well A1 shows its tooltip without duplicating its aria-label in the live region.
    fireEvent.focus(wellA1);
    const tooltipA1 = screen.getByText("sample_a1").parentElement;
    if (tooltipA1 === null) throw new Error("Expected tooltip container for well A1");
    expect(within(tooltipA1).getByText("A1")).toBeVisible();
    expect(within(tooltipA1).getByText("sample_a1")).toBeVisible();
    expect(within(tooltipA1).getByText("18 targets with data")).toBeVisible();
    expect(
      screen.queryByText("Plate 1, well A1, sample_a1: 18 targets with data."),
    ).not.toBeInTheDocument();

    // ArrowRight moves focus and roving tabIndex to A2.
    fireEvent.keyDown(wellA1, { key: "ArrowRight" });
    expect(wellA2).toHaveFocus();
    expect(wellA2).toHaveAttribute("tabindex", "0");
    expect(wellA1).toHaveAttribute("tabindex", "-1");
    const tooltipA2 = screen.getByText("sample_a2").parentElement;
    if (tooltipA2 === null) throw new Error("Expected tooltip container for well A2");
    expect(within(tooltipA2).getByText("A2")).toBeVisible();
    expect(within(tooltipA2).getByText("sample_a2")).toBeVisible();
    expect(within(tooltipA2).getByText("0 targets with data")).toBeVisible();

    // ArrowDown moves to B2, Ctrl+Home jumps back to A1, Ctrl+End jumps to B2.
    fireEvent.keyDown(wellA2, { key: "ArrowDown" });
    expect(wellB2).toHaveFocus();
    expect(wellB2).toHaveAttribute("tabindex", "0");

    fireEvent.keyDown(wellB2, { key: "Home", ctrlKey: true });
    expect(wellA1).toHaveFocus();

    fireEvent.keyDown(wellA1, { key: "End", ctrlKey: true });
    expect(wellB2).toHaveFocus();

    // Blurring when not pinned hides the details.
    fireEvent.blur(wellB2);
    expect(screen.queryByText("sample_b2")).not.toBeInTheDocument();
  });

  it("shows the focused well's details when keyboard focus moves to another well while the pointer hovers the first", () => {
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 18,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
      makeSample({
        libraryId: 1,
        name: "sample_a2",
        targets: 5,
        plate: { plate: "Plate 1", row: "A", col: 2 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    const wellA1 = screen.getByRole("button", {
      name: "A1, sample_a1: 18 targets with data",
    });
    const wellA2 = screen.getByRole("button", {
      name: "A2, sample_a2: 5 targets with data",
    });

    // Pointer rests over well A1 and announces it in the live region.
    fireEvent.mouseEnter(wellA1);
    expect(screen.getByText("sample_a1")).toBeVisible();
    expect(
      screen.getByText("Plate 1, well A1, sample_a1: 18 targets with data."),
    ).toBeInTheDocument();

    // Keyboard focus moves to well A2 without the pointer leaving well A1.
    fireEvent.focus(wellA2);
    expect(screen.queryByText("sample_a1")).not.toBeInTheDocument();
    const tooltipA2 = screen.getByText("sample_a2").parentElement;
    if (tooltipA2 === null) throw new Error("Expected tooltip container for well A2");
    expect(within(tooltipA2).getByText("A2")).toBeVisible();
    expect(within(tooltipA2).getByText("sample_a2")).toBeVisible();
    expect(within(tooltipA2).getByText("5 targets with data")).toBeVisible();
    expect(
      screen.queryByText("Plate 1, well A1, sample_a1: 18 targets with data."),
    ).not.toBeInTheDocument();
  });

  it("pins well details on tap/click until another well is chosen, Escape is pressed, or clicking outside", () => {
    const summary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 15,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
      makeSample({
        libraryId: 1,
        name: "sample_b2",
        targets: 7,
        plate: { plate: "Plate 1", row: "B", col: 2 },
      }),
    ]);

    render(<PlateView summary={summary} />);

    const wellA1 = screen.getByRole("button", {
      name: "A1, sample_a1: 15 targets with data",
    });
    const wellB2 = screen.getByRole("button", {
      name: "B2, sample_b2: 7 targets with data",
    });

    // Clicking/tapping well A1 pins its details even after pointer leaves and focus blurs.
    fireEvent.click(wellA1);
    fireEvent.mouseLeave(wellA1);
    fireEvent.blur(wellA1);
    expect(wellA1).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("sample_a1")).toBeVisible();

    // Choosing another well moves the pinned selection to it.
    fireEvent.click(wellB2);
    expect(wellA1).toHaveAttribute("aria-pressed", "false");
    expect(wellB2).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("sample_a1")).not.toBeInTheDocument();
    expect(screen.getByText("sample_b2")).toBeVisible();

    // Pressing Escape dismisses the pinned details.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(wellB2).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sample_b2")).not.toBeInTheDocument();

    // Pressing Enter on a focused well pins it, and clicking outside dismisses it.
    fireEvent.focus(wellA1);
    fireEvent.keyDown(wellA1, { key: "Enter" });
    expect(wellA1).toHaveAttribute("aria-pressed", "true");
    fireEvent.blur(wellA1);
    expect(screen.getByText("sample_a1")).toBeVisible();

    fireEvent.pointerDown(screen.getByRole("heading", { name: "Plates" }));
    expect(wellA1).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sample_a1")).not.toBeInTheDocument();

    // Pressing Space pins it, and pressing Space again toggles it off.
    fireEvent.focus(wellB2);
    fireEvent.keyDown(wellB2, { key: " " });
    expect(wellB2).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(wellB2, { key: " " });
    expect(wellB2).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText("sample_b2")).not.toBeInTheDocument();
  });

  it("refreshes a pinned well's figures when the summary updates", () => {
    const firstSummary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 12,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
    ]);
    const updatedSummary = makePlateSummary([
      makeSample({
        libraryId: 0,
        name: "sample_a1",
        targets: 4,
        plate: { plate: "Plate 1", row: "A", col: 1 },
      }),
    ]);

    const { rerender } = render(<PlateView summary={firstSummary} />);

    fireEvent.click(screen.getByRole("button", { name: "A1, sample_a1: 12 targets with data" }));
    const tooltipBefore = screen.getByText("sample_a1").parentElement;
    if (tooltipBefore === null) throw new Error("Expected tooltip before rerender");
    expect(within(tooltipBefore).getByText("12 targets with data")).toBeVisible();

    rerender(<PlateView summary={updatedSummary} />);
    const tooltipAfter = screen.getByText("sample_a1").parentElement;
    if (tooltipAfter === null) throw new Error("Expected tooltip after rerender");
    expect(within(tooltipAfter).getByText("4 targets with data")).toBeVisible();
  });

  it("draws no-data crosses only from the resolved per-well sample on multi-run PMOs and handles unnamed plates with singular sample wording", () => {
    const summary: PmoSummary = {
      ...makePlateSummary([
        makeSample({
          libraryId: 0,
          name: "sample_a1",
          run: "run1",
          targets: 10,
          plate: { plate: "", row: "A", col: 1 },
        }),
        makeSample({
          libraryId: 0,
          name: "sample_a1",
          run: "run2",
          targets: 0,
          plate: { plate: "", row: "A", col: 1 },
        }),
      ]),
      runs: 2,
    };

    render(<PlateView summary={summary} />);

    // Unnamed plate gets a non-empty landmark name and singular library sample wording.
    const landmark = screen.getByRole("region", { name: "Plate" });
    expect(screen.getByText(/Plate: 1 library sample\./)).toBeInTheDocument();

    // Well A1 resolved to run1 (10 targets), so no "No data" cross path is drawn over it.
    expect(landmark.querySelectorAll("path")).toHaveLength(0);
  });
});

describe("ControlsCheck", () => {
  it("renders failing controls across multiple runs without key collisions", () => {
    const summary: PmoSummary = {
      ...makePlateSummary([
        makeSample({
          libraryId: 0,
          name: "neg_ctrl",
          run: "run1",
          targets: 1,
          reads: 1,
          control: "negative",
          plate: null,
        }),
        makeSample({
          libraryId: 0,
          name: "neg_ctrl",
          run: "run2",
          targets: 2,
          reads: 25,
          control: "negative",
          plate: null,
        }),
        makeSample({
          libraryId: 1,
          name: "pos_ctrl",
          run: "run1",
          targets: 0,
          reads: 0,
          control: "positive",
          plate: null,
        }),
        makeSample({
          libraryId: 1,
          name: "pos_ctrl",
          run: "run2",
          targets: 0,
          reads: 0,
          control: "positive",
          plate: null,
        }),
      ]),
      runs: 2,
    };

    render(<ControlsCheck summary={summary} />);

    expect(screen.getByText("Negative control neg_ctrl has 1 read.")).toBeVisible();
    expect(screen.getByText("Negative control neg_ctrl has 25 reads.")).toBeVisible();
    expect(screen.getAllByText("Positive control pos_ctrl has no data.")).toHaveLength(2);
  });
});

describe("DensityView", () => {
  it("right-aligns the final x-axis tick, formats y-axis counts, and uses singular/plural target counts on hover", () => {
    const samples = [
      makeSample({
        libraryId: 0,
        name: "low_sample",
        targets: 1,
        plate: null,
        density: { value: 10, method: "qPCR", from: "library" },
      }),
      makeSample({
        libraryId: 1,
        name: "mid_sample",
        targets: 18,
        plate: null,
        density: { value: 1000, method: "qPCR", from: "library" },
      }),
      makeSample({
        libraryId: 2,
        name: "high_sample",
        targets: 1200,
        plate: null,
        density: { value: 25000, method: "qPCR", from: "library" },
      }),
    ];
    const summary: PmoSummary = {
      ...makePlateSummary(samples),
      targets: Array.from({ length: 1200 }, (_, index) => ({
        name: `t${index}`,
        samples: 1,
        alleles: [],
        heterozygosity: null,
      })),
    };

    const { container } = render(<DensityView summary={summary} />);

    // Rightmost x-axis tick (100,000) is end-anchored so it does not clip outside the SVG viewBox.
    const rightmostTick = screen.getByText("100,000");
    expect(rightmostTick).toHaveAttribute("text-anchor", "end");

    // Y-axis maximum uses formatted count.
    expect(screen.getByText("1,200")).toBeInTheDocument();

    // Hovering a 1-target sample uses singular wording; hovering an 18-target sample uses plural.
    const circles = container.querySelectorAll("circle");
    expect(circles).toHaveLength(3);
    const firstDot = circles[0];
    const secondDot = circles[1];
    if (firstDot === undefined || secondDot === undefined) throw new Error("Expected plot dots");

    fireEvent.mouseEnter(firstDot);
    expect(screen.getByText("low_sample: 10 per µL, 1 target with data.")).toBeVisible();

    fireEvent.mouseEnter(secondDot);
    expect(screen.getByText("mid_sample: 1,000 per µL, 18 targets with data.")).toBeVisible();
  });
});
