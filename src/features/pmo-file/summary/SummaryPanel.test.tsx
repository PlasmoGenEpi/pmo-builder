import { fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { describe, expect, it, vi } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";

import { SummaryPanel } from "./SummaryPanel";

async function openAndRenderSummary(pmo: PortableMicrohaplotypeObject) {
  const store = createTestStore();
  await store.getState().actions.initialise();
  const file = new File([stringifyPmo(pmo)], "study.json", { type: "application/json" });
  const outcome = await workingPmoSessionOf(store).open({
    kind: "file",
    file,
    name: file.name,
    origin: { kind: "chosen" },
  });
  if (outcome.kind !== "opened") throw new Error("Expected PMO to open");
  await renderWithStore(
    <SummaryPanel
      source="original"
      minReads={null}
      onMinReadsChange={vi.fn<(value: number | null) => void>()}
      maxReads={null}
    />,
    { store },
  );
  await screen.findByText("Reads by sample and target");
}

describe("SummaryPanel: headline tiles", () => {
  it("shows counts, percentages and denominators for the example PMO", async () => {
    const example = buildExamplePmo();
    await openAndRenderSummary(example);

    const samplesTile = screen.getByRole("button", { name: /^Samples with data/ });
    expect(within(samplesTile).getByText("49")).toBeVisible();
    expect(within(samplesTile).getByText("98% of 50 library samples")).toBeVisible();

    const targetsTile = screen.getByRole("button", { name: /^Targets with data/ });
    expect(within(targetsTile).getByText("21")).toBeVisible();
    expect(within(targetsTile).getByText("8% of 276 targets")).toBeVisible();

    const polyclonalTile = screen.getByRole("button", {
      name: /^Samples with more than one clone/,
    });
    expect(within(polyclonalTile).getByText("31")).toBeVisible();
    expect(within(polyclonalTile).getByText("63% of 49 samples with data")).toBeVisible();

    const medianTile = screen.getByRole("button", { name: /^Median targets per sample/ });
    expect(within(medianTile).getByText(/^Median reads per sample:/)).toBeVisible();
  });

  it("moves to the section behind each headline tile and moves focus there", async () => {
    const user = userEvent.setup();
    const example = buildExamplePmo();
    await openAndRenderSummary(example);

    await user.click(screen.getByRole("button", { name: /^Samples with data/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Samples" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /^Targets with data/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Targets" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /^Median targets per sample/ }));
    expect(
      screen.getByRole("heading", { level: 2, name: "Reads by sample and target" }),
    ).toHaveFocus();

    await user.click(screen.getByRole("button", { name: /^Samples with more than one clone/ }));
    expect(screen.getByRole("heading", { level: 2, name: "Samples" })).toHaveFocus();
  });

  it("avoids NaN percentages when no samples have data", async () => {
    const base = richPmo();
    const emptyDetections: PortableMicrohaplotypeObject = {
      ...base,
      detected_microhaplotypes: [],
    };
    await openAndRenderSummary(emptyDetections);

    const samplesTile = screen.getByRole("button", { name: /^Samples with data/ });
    expect(within(samplesTile).getByText("0")).toBeVisible();
    expect(within(samplesTile).getByText(/0% of \d+ library samples/)).toBeVisible();

    const polyclonalTile = screen.getByRole("button", {
      name: /^Samples with more than one clone/,
    });
    expect(within(polyclonalTile).getByText("0")).toBeVisible();
    expect(polyclonalTile.textContent).not.toContain("NaN");
    expect(polyclonalTile.textContent).not.toContain("%");
  });
});

describe("SummaryPanel: Show targets with no data", () => {
  it("sits in the view toolbar rather than the reads grid heading and updates both the grid and Targets table", async () => {
    const user = userEvent.setup();
    const example = buildExamplePmo();
    await openAndRenderSummary(example);

    const toggle = screen.getByRole("switch", { name: "Show targets with no data" });
    const readsHeading = screen.getByRole("heading", {
      level: 2,
      name: "Reads by sample and target",
    });
    const readsSection = readsHeading.closest("section");
    if (readsSection === null) throw new Error("Expected reads grid section");

    // In the view toolbar beside the other view controls, not in the reads grid section.
    expect(
      within(readsSection).queryByRole("switch", { name: "Show targets with no data" }),
    ).toBeNull();
    const toolbar = screen.getByRole("navigation", { name: "On this page" }).parentElement;
    if (toolbar === null) throw new Error("Expected view toolbar container");
    expect(within(toolbar).getByLabelText("Minimum reads per microhaplotype")).toBeVisible();
    expect(within(toolbar).getByRole("switch", { name: "Show targets with no data" })).toBe(toggle);

    const targetsHeading = screen.getByRole("heading", { level: 2, name: "Targets" });
    const targetsSection = targetsHeading.closest("section");
    if (targetsSection === null) throw new Error("Expected targets section");

    // Initially only the 21 targets with data appear in both the grid and the Targets table,
    // while the row count still reflects all 276 targets in the file.
    expect(toggle).not.toBeChecked();
    expect(within(readsSection).getByText(/50 samples at 21 targets/)).toBeInTheDocument();
    expect(within(targetsSection).getByText("Showing 21 of 276 rows")).toBeVisible();
    expect(within(targetsSection).getAllByRole("row")).toHaveLength(22);

    // Searching narrows the shown count while keeping the 276-target total.
    const targetsSearch = within(targetsSection).getByRole("searchbox", { name: "Search Targets" });
    const firstTargetName = within(targetsSection)
      .getAllByRole("row")[1]
      ?.querySelector("button")?.textContent;
    if (!firstTargetName) throw new Error("Expected a first target row button");
    await user.type(targetsSearch, firstTargetName);
    expect(within(targetsSection).getByText("Showing 1 of 276 rows")).toBeVisible();
    await user.click(
      within(targetsSection).getByRole("button", { name: "Clear search for Targets" }),
    );
    expect(within(targetsSection).getByText("Showing 21 of 276 rows")).toBeVisible();

    // Turning it on adds all 276 targets to both views.
    await user.click(toggle);
    expect(toggle).toBeChecked();
    expect(within(readsSection).getByText(/50 samples at 276 targets/)).toBeInTheDocument();
    expect(within(targetsSection).getByText("Showing 276 of 276 rows")).toBeVisible();
    expect(within(targetsSection).getAllByRole("row")).toHaveLength(277);

    // Turning it back off hides the empty targets from both views again.
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(within(readsSection).getByText(/50 samples at 21 targets/)).toBeInTheDocument();
    expect(within(targetsSection).getByText("Showing 21 of 276 rows")).toBeVisible();
    expect(within(targetsSection).getAllByRole("row")).toHaveLength(22);
  });

  it("keeps Group targets by reaction in the reads grid heading", async () => {
    const user = userEvent.setup();
    await openAndRenderSummary(richPmo());

    const readsHeading = screen.getByRole("heading", {
      level: 2,
      name: "Reads by sample and target",
    });
    const readsSection = readsHeading.closest("section");
    if (readsSection === null) throw new Error("Expected reads grid section");

    expect(
      within(readsSection).queryByRole("switch", { name: "Show targets with no data" }),
    ).toBeNull();
    expect(
      within(readsSection).queryByRole("switch", { name: "Group targets by reaction" }),
    ).toBeNull();

    // Turning on empty targets brings pool2 into view, surfacing the reaction grouping toggle in the reads heading.
    await user.click(screen.getByRole("switch", { name: "Show targets with no data" }));
    expect(
      within(readsSection).getByRole("switch", { name: "Group targets by reaction" }),
    ).toBeVisible();
    expect(
      within(readsSection).queryByRole("switch", { name: "Show targets with no data" }),
    ).toBeNull();
  });
});

describe("SummaryPanel: reads grid links to tables", () => {
  it("choosing a cell in the reads grid selects its target and finds its sample in the tables below", async () => {
    const user = userEvent.setup();
    const example = buildExamplePmo();
    await openAndRenderSummary(example);

    const gridRegion = screen.getByRole("region", { name: "Reads by sample and target" });
    const samplesTable = screen.getByRole("table", { name: "Samples" });
    const targetsTable = screen.getByRole("table", { name: "Targets" });

    // Filter the Samples table so most rows are hidden before choosing a cell.
    const samplesSearch = screen.getByRole("searchbox", { name: "Search Samples" });
    await user.type(samplesSearch, "no-such-sample-filter");
    expect(within(samplesTable).getByText("Nothing matches the search.")).toBeVisible();

    // Move to the second column of row 0 via keyboard on the grid.
    gridRegion.focus();
    fireEvent.keyDown(gridRegion, { key: "ArrowRight" });
    fireEvent.keyDown(gridRegion, { key: "ArrowRight" });

    // Extract the chosen sample and target from the grid's status strip.
    const readsSection = gridRegion.closest("section")?.parentElement?.closest("section");
    if (readsSection === null || readsSection === undefined) {
      throw new Error("Expected reads section");
    }
    const status = within(readsSection).getByRole("status");
    const match = /^(.+?) at (.+?):/.exec(status.textContent ?? "");
    const chosenSample = match?.[1] ?? "";
    const chosenTarget = match?.[2] ?? "";
    expect(chosenSample).not.toBe("");
    expect(chosenTarget).not.toBe("");

    // The Targets table selects the chosen target and AlleleBars shows its microhaplotypes.
    expect(
      within(targetsTable).getByRole("button", { name: chosenTarget, pressed: true }),
    ).toBeVisible();
    expect(screen.getByText(new RegExp(`Microhaplotypes at ${chosenTarget}`))).toBeVisible();

    // The Samples search was cleared and the chosen sample row is marked.
    expect(samplesSearch).toHaveValue("");
    const sampleRow = within(samplesTable).getByText(chosenSample).closest("tr");
    if (sampleRow === null) throw new Error("Expected sample row");
    expect(sampleRow).toHaveAttribute("aria-current", "true");
  });

  it("choosing a target header selects that target and choosing a row label marks that sample", async () => {
    const user = userEvent.setup();
    const example = buildExamplePmo();
    await openAndRenderSummary(example);

    const gridRegion = screen.getByRole("region", { name: "Reads by sample and target" });
    const targetsTable = screen.getByRole("table", { name: "Targets" });
    const samplesTable = screen.getByRole("table", { name: "Samples" });

    // Click the third target column header along the top of the grid.
    const targetButtons = within(gridRegion).getAllByRole("button");
    expect(targetButtons.length).toBeGreaterThan(2);
    const targetButton = targetButtons[2];
    if (targetButton === undefined) throw new Error("Expected a third target button");
    const targetName = targetButton.textContent ?? "";
    await user.click(targetButton);

    expect(
      within(targetsTable).getByRole("button", { name: targetName, pressed: true }),
    ).toBeVisible();
    expect(screen.getByText(new RegExp(`Microhaplotypes at ${targetName}`))).toBeVisible();

    // Click row 1 on the labels canvas to mark the second sample in the Samples table.
    const labelsCanvas = gridRegion.querySelectorAll("canvas")[0];
    if (labelsCanvas === undefined) throw new Error("Expected labels canvas");
    labelsCanvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 140,
      bottom: 600,
      width: 140,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // Example PMO has 50 samples => rowHeight = min(14, floor(640 / 50)) = 12 px; row 1 is y = 18.
    fireEvent.click(labelsCanvas, { clientX: 40, clientY: 18 });

    const markedRows = Array.from(samplesTable.querySelectorAll('tbody tr[aria-current="true"]'));
    expect(markedRows).toHaveLength(1);
  });
});
