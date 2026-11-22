import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { PmoSummary } from "@/domain/tools/types";

import { ReadsGrid } from "./ReadsGrid";

function makeSummary(sampleCount: number, targetCount: number): PmoSummary {
  const samples = Array.from({ length: sampleCount }, (_, i) => ({
    libraryId: i,
    name: `sample_${i + 1}`,
    specimen: `spec_${i + 1}`,
    run: "run1",
    targets: targetCount,
    reads: targetCount * 10,
    maxAlleles: 1,
    control: null,
    plate: null,
    density: null,
    rawReads: null,
    stageReads: [],
  }));
  const targets = Array.from({ length: targetCount }, (_, i) => ({
    name: `target_${i + 1}`,
    samples: sampleCount,
    alleles: [],
    heterozygosity: null,
  }));
  const reads = Array.from({ length: sampleCount * targetCount }, (_, index) => (index + 1) * 5);
  return {
    minReads: 0,
    librarySamples: sampleCount,
    runs: 1,
    headline: {
      samplesWithData: sampleCount,
      targetsWithData: targetCount,
      medianTargets: targetCount,
      medianReads: targetCount * 10,
      polyclonal: 0,
    },
    samples,
    targets,
    reactions: [],
    stages: [],
    grid: { columns: targetCount, reads },
  };
}

describe("ReadsGrid", () => {
  it("renders a focusable scroll region with an accessible summary, legend, and hover details for many targets", () => {
    const summary = makeSummary(4, 276);
    const columns = summary.targets.map((_, index) => index);
    render(<ReadsGrid summary={summary} columns={columns} />);

    const region = screen.getByRole("region", { name: "Reads by sample and target" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(
      screen.getByText(
        "A grid of reads for 4 samples at 276 targets. The tables below give the same figures.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No reads")).toBeInTheDocument();
    expect(screen.getByText(/5,520 reads \(log scale\)/)).toBeInTheDocument();

    const cellsCanvas = region.querySelectorAll("canvas")[1];
    if (cellsCanvas === undefined) throw new Error("Expected cells canvas");
    cellsCanvas.getBoundingClientRect = () => ({
      left: 140,
      top: 0,
      right: 800,
      bottom: 56,
      width: 660,
      height: 56,
      x: 140,
      y: 0,
      toJSON: () => ({}),
    });

    // Hover the first target in row 0.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 1, clientY: 5 });
    expect(screen.getByText("sample_1")).toBeInTheDocument();
    expect(screen.getByText("target_1")).toBeInTheDocument();
    expect(screen.getByText("5 reads")).toBeInTheDocument();

    // Hover the last target (target_276) in row 0.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 659, clientY: 5 });
    expect(screen.getByText("target_276")).toBeInTheDocument();
    expect(screen.getByText("1,380 reads")).toBeInTheDocument();

    fireEvent.mouseLeave(cellsCanvas);
    expect(screen.queryByText("target_276")).not.toBeInTheDocument();
  });

  it("places reaction group headers inside the scroll region and resolves hover across group gaps", () => {
    const summary = makeSummary(2, 4);
    const columns = [0, 1, 2, 3];
    const groups = [
      { label: "pool-1", count: 2 },
      { label: "pool-2", count: 2 },
    ];
    render(<ReadsGrid summary={summary} columns={columns} groups={groups} />);

    const region = screen.getByRole("region", { name: "Reads by sample and target" });
    expect(region).toHaveTextContent("pool-1");
    expect(region).toHaveTextContent("pool-2");

    const cellsCanvas = region.querySelectorAll("canvas")[1];
    if (cellsCanvas === undefined) throw new Error("Expected cells canvas");
    // Default container width is 800, label width 140 => cells width 660, gap 6 => cellWidth = (660 - 6) / 4 = 163.5.
    cellsCanvas.getBoundingClientRect = () => ({
      left: 140,
      top: 20,
      right: 800,
      bottom: 48,
      width: 660,
      height: 28,
      x: 140,
      y: 20,
      toJSON: () => ({}),
    });

    // Hover column 2 (first column of pool-2): starts at 2 * 163.5 + 6 = 333 inside cellsCanvas.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 340, clientY: 20 + 20 });
    expect(screen.getByText("sample_2")).toBeInTheDocument();
    expect(screen.getByText("target_3")).toBeInTheDocument();
    expect(screen.getByText("35 reads")).toBeInTheDocument();

    // Hover inside the 6 px gap between pool-1 and pool-2 (x = 329): clears hover.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 329, clientY: 20 + 20 });
    expect(screen.queryByText("target_3")).not.toBeInTheDocument();
  });
});
