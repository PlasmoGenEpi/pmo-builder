import { screen, within } from "@testing-library/react";
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
