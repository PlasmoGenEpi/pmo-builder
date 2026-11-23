import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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
    maxAlleles: 2,
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
  const alleles = Array.from({ length: sampleCount * targetCount }, (_, index) =>
    index % 2 === 0 ? 1 : 2,
  );
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
    grid: { columns: targetCount, reads, alleles },
  };
}

describe("ReadsGrid", () => {
  it("shows group names when columns are narrow, gives an accurate hidden description, and reports hover details", () => {
    const summary = makeSummary(4, 276);
    const columns = summary.targets.map((_, index) => index);
    render(<ReadsGrid summary={summary} columns={columns} />);

    const region = screen.getByRole("region", { name: "Reads by sample and target" });
    const grid = screen.getByRole("application", { name: "Reads by sample and target" });
    expect(region).not.toHaveAttribute("tabindex");
    expect(grid).toHaveAttribute("tabindex", "0");
    expect(grid).toHaveAttribute("aria-roledescription", "reads grid");
    expect(
      screen.getByText(
        "A grid of reads for 4 samples at 276 targets. Use the arrow keys to move between cells and read each sample and target's figures. The tables below give totals per sample and per target, not individual cells.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("No reads")).toBeInTheDocument();
    expect(screen.getByText(/5,520 reads \(log scale\)/)).toBeInTheDocument();

    // With 276 targets the columns are too narrow for target names, so compact group labels appear instead.
    expect(within(region).queryByRole("button", { name: "target_1" })).not.toBeInTheDocument();
    expect(within(region).getByText("Targets 1–50")).toBeInTheDocument();
    expect(within(region).getByText("251–276")).toBeInTheDocument();
    expect(within(region).queryByText("Targets 251–276")).not.toBeInTheDocument();

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
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("sample_1")).toBeInTheDocument();
    expect(within(tooltip).getByText("target_1")).toBeInTheDocument();
    expect(within(tooltip).getByText("5 reads")).toBeInTheDocument();

    // Pressing Escape dismisses the hover tooltip (WCAG 1.4.13).
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    // Hover the last target (target_276) in row 0.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 659, clientY: 5 });
    const updatedTooltip = screen.getByRole("tooltip");
    expect(within(updatedTooltip).getByText("target_276")).toBeInTheDocument();
    expect(within(updatedTooltip).getByText("1,380 reads")).toBeInTheDocument();

    fireEvent.mouseLeave(cellsCanvas);
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("shows reaction group headers and clickable target headers when columns are wide enough, and resolves hover across group gaps", async () => {
    const user = userEvent.setup();
    const summary = makeSummary(2, 4);
    const columns = [0, 1, 2, 3];
    const groups = [
      { label: "pool-1", count: 2 },
      { label: "pool-2", count: 2 },
    ];
    const onTargetSelect = vi.fn<(targetName: string) => void>();
    render(
      <ReadsGrid
        summary={summary}
        columns={columns}
        groups={groups}
        selectedTarget="target_2"
        onTargetSelect={onTargetSelect}
      />,
    );

    const region = screen.getByRole("region", { name: "Reads by sample and target" });
    expect(region).toHaveTextContent("pool-1");
    expect(region).toHaveTextContent("pool-2");

    // Target names appear along the top and can be chosen.
    expect(within(region).getByRole("button", { name: "target_2", pressed: true })).toBeVisible();
    await user.click(within(region).getByRole("button", { name: "target_3" }));
    expect(onTargetSelect).toHaveBeenCalledWith("target_3");

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
    const tooltip = screen.getByRole("tooltip");
    expect(within(tooltip).getByText("sample_2")).toBeInTheDocument();
    expect(within(tooltip).getByText("target_3")).toBeInTheDocument();
    expect(within(tooltip).getByText("35 reads")).toBeInTheDocument();

    // Hover inside the 6 px gap between pool-1 and pool-2 (x = 329): clears hover.
    fireEvent.mouseMove(cellsCanvas, { clientX: 140 + 329, clientY: 20 + 20 });
    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });

  it("chooses a cell on click, keeps its details on screen, and lets row labels choose a sample", () => {
    const summary = makeSummary(3, 4);
    const columns = [0, 1, 2, 3];
    const onTargetSelect = vi.fn<(targetName: string) => void>();
    const onSampleSelect = vi.fn<(sampleKey: string) => void>();
    render(
      <ReadsGrid
        summary={summary}
        columns={columns}
        onTargetSelect={onTargetSelect}
        onSampleSelect={onSampleSelect}
      />,
    );

    const region = screen.getByRole("region", { name: "Reads by sample and target" });
    const [labelsCanvas, cellsCanvas] = region.querySelectorAll("canvas");
    if (labelsCanvas === undefined || cellsCanvas === undefined) {
      throw new Error("Expected labels and cells canvases");
    }
    labelsCanvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 140,
      bottom: 42,
      width: 140,
      height: 42,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    cellsCanvas.getBoundingClientRect = () => ({
      left: 140,
      top: 0,
      right: 800,
      bottom: 42,
      width: 660,
      height: 42,
      x: 140,
      y: 0,
      toJSON: () => ({}),
    });

    // Click row 1, column 1 (sample_2, target_2: index 5 -> reads 30, alleles 2).
    fireEvent.click(cellsCanvas, { clientX: 140 + 170, clientY: 20 });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("sample_2");
    expect(status).toHaveTextContent("target_2");
    expect(status).toHaveTextContent("30 reads");
    expect(status).toHaveTextContent("2 microhaplotypes");
    expect(onTargetSelect).toHaveBeenCalledWith("target_2");
    expect(onSampleSelect).toHaveBeenCalledWith("run1\u0000sample_2");

    // Moving the mouse away leaves the chosen details strip intact.
    fireEvent.mouseLeave(cellsCanvas);
    expect(status).toHaveTextContent("sample_2");
    expect(status).toHaveTextContent("target_2");

    // Clicking row 2's label selects sample_3.
    fireEvent.click(labelsCanvas, { clientX: 40, clientY: 32 });
    expect(onSampleSelect).toHaveBeenLastCalledWith("run1\u0000sample_3");
  });

  it("moves the chosen cell with arrow keys, Home and End while keeping focus on the grid", () => {
    const summary = makeSummary(3, 4);
    const columns = [0, 1, 2, 3];
    const onTargetSelect = vi.fn<(targetName: string) => void>();
    const onSampleSelect = vi.fn<(sampleKey: string) => void>();
    render(
      <ReadsGrid
        summary={summary}
        columns={columns}
        onTargetSelect={onTargetSelect}
        onSampleSelect={onSampleSelect}
      />,
    );

    const grid = screen.getByRole("application", { name: "Reads by sample and target" });
    grid.focus();
    expect(grid).toHaveFocus();

    // First arrow press selects cell (0, 0): sample_1, target_1 (5 reads, 1 microhaplotype).
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const status = screen.getByRole("status");
    expect(grid).toHaveFocus();
    expect(status).toHaveTextContent("sample_1");
    expect(status).toHaveTextContent("target_1");
    expect(status).toHaveTextContent("5 reads");
    expect(status).toHaveTextContent("1 microhaplotype");
    expect(onTargetSelect).toHaveBeenLastCalledWith("target_1");
    expect(onSampleSelect).toHaveBeenLastCalledWith("run1\u0000sample_1");

    // ArrowRight moves to (0, 1): sample_1, target_2 (10 reads, 2 microhaplotypes).
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(status).toHaveTextContent("sample_1");
    expect(status).toHaveTextContent("target_2");
    expect(status).toHaveTextContent("10 reads");
    expect(status).toHaveTextContent("2 microhaplotypes");

    // ArrowDown moves to (1, 1): sample_2, target_2 (30 reads, 2 microhaplotypes).
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    expect(status).toHaveTextContent("sample_2");
    expect(status).toHaveTextContent("target_2");
    expect(status).toHaveTextContent("30 reads");
    expect(onSampleSelect).toHaveBeenLastCalledWith("run1\u0000sample_2");

    // End jumps to the last column of the current row: (1, 3): sample_2, target_4.
    fireEvent.keyDown(grid, { key: "End" });
    expect(status).toHaveTextContent("sample_2");
    expect(status).toHaveTextContent("target_4");

    // Home jumps back to the first column of the current row: (1, 0): sample_2, target_1.
    fireEvent.keyDown(grid, { key: "Home" });
    expect(status).toHaveTextContent("sample_2");
    expect(status).toHaveTextContent("target_1");

    // ArrowUp moves to (0, 0): sample_1, target_1.
    fireEvent.keyDown(grid, { key: "ArrowUp" });
    expect(status).toHaveTextContent("sample_1");
    expect(status).toHaveTextContent("target_1");
    expect(grid).toHaveFocus();
  });

  it("takes focus as one control on Tab without stopping on target header buttons, and preserves arrow navigation after clicking a target header", async () => {
    const user = userEvent.setup();
    const summary = makeSummary(2, 4);
    const columns = [0, 1, 2, 3];
    const onTargetSelect = vi.fn<(targetName: string) => void>();
    render(
      <div>
        <button type="button">Before grid</button>
        <ReadsGrid summary={summary} columns={columns} onTargetSelect={onTargetSelect} />
        <button type="button">After grid</button>
      </div>,
    );

    const beforeButton = screen.getByRole("button", { name: "Before grid" });
    const grid = screen.getByRole("application", { name: "Reads by sample and target" });
    const afterButton = screen.getByRole("button", { name: "After grid" });
    const targetButtons = within(grid).getAllByRole("button");
    expect(targetButtons).toHaveLength(4);
    for (const button of targetButtons) {
      expect(button).toHaveAttribute("tabindex", "-1");
    }

    beforeButton.focus();
    await user.tab();
    expect(grid).toHaveFocus();

    await user.tab();
    expect(afterButton).toHaveFocus();

    // Clicking a target header selects it and returns focus to the grid widget so arrow keys keep working.
    await user.click(within(grid).getByRole("button", { name: "target_3" }));
    expect(onTargetSelect).toHaveBeenCalledWith("target_3");
    expect(grid).toHaveFocus();

    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(screen.getByRole("status")).toHaveTextContent("sample_1 at target_1");
  });

  it("announces whole chosen-cell sentences for zero reads and singular or plural counts", () => {
    const base = makeSummary(2, 2);
    const summary: PmoSummary = {
      ...base,
      grid: {
        columns: 2,
        reads: [0, 1, 30, 12],
        alleles: [0, 1, 2, 1],
      },
    };
    render(<ReadsGrid summary={summary} columns={[0, 1]} />);

    const grid = screen.getByRole("application", { name: "Reads by sample and target" });
    const status = screen.getByRole("status");
    grid.focus();

    // (0, 0): 0 reads, 0 microhaplotypes.
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(status).toHaveTextContent("sample_1 at target_1: no reads, 0 microhaplotypes.");

    // (0, 1): 1 read, 1 microhaplotype.
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(status).toHaveTextContent("sample_1 at target_2: 1 read, 1 microhaplotype.");

    // (1, 1) then (1, 0): 30 reads, 2 microhaplotypes.
    fireEvent.keyDown(grid, { key: "ArrowDown" });
    fireEvent.keyDown(grid, { key: "ArrowLeft" });
    expect(status).toHaveTextContent("sample_2 at target_1: 30 reads, 2 microhaplotypes.");
  });

  it("uses singular wording in the legend and hidden description for a 1-sample, 1-target, 1-read grid", () => {
    const base = makeSummary(1, 1);
    const summary: PmoSummary = {
      ...base,
      grid: { columns: 1, reads: [1], alleles: [1] },
    };
    render(<ReadsGrid summary={summary} columns={[0]} />);

    expect(screen.getByText(/A grid of reads for 1 sample at 1 target\./)).toBeInTheDocument();
    expect(screen.getByText(/1 read \(log scale\)/)).toBeInTheDocument();
  });
});
