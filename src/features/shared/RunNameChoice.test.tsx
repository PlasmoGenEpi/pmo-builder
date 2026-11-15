import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TableImport } from "@/features/table-import";

import { RunNameChoice, type RunNameSection } from "./RunNameChoice";
import { renderWithStore, textFile } from "./testing";

const MODES = {
  none: "No run is named.",
  fixed: "One run for every row.",
  column: "A column names the run.",
};

async function setup(section: RunNameSection, knownNames: readonly string[]) {
  const user = userEvent.setup();
  const slot =
    section === "microhaplotypes"
      ? ({ section: "microhaplotypes" } as const)
      : ({ section: "readCounts", part: "totals" } as const);
  const rendered = await renderWithStore(
    <TableImport slot={slot} label="Test table" description="A table.">
      {(matching) => (
        <RunNameChoice
          section={section}
          matching={matching}
          description="Which run."
          modeDescriptions={MODES}
          columnHint="The column of the test table that holds each row's run name."
          knownNames={knownNames}
          knownLabel="Known runs:"
        />
      )}
    </TableImport>,
  );
  const text =
    section === "microhaplotypes"
      ? "sampleID,locus,asv,reads,run\nS1,t1,ACGT,10,runA\nS2,t1,ACGT,12,runB\n"
      : "sample_name,raw_read_count,run\nS1,100,runA\n";
  await user.upload(screen.getByLabelText("Choose test table file"), textFile("t.csv", text));
  await act(() => rendered.store.getState().actions.flush());
  return { ...rendered, user };
}

describe("RunNameChoice", () => {
  it("offers known run names once each and stores the choice in the right section", async () => {
    const { user, store } = await setup("readCounts", ["runA", " runA ", "", "runB"]);
    await user.click(await screen.findByRole("radio", { name: /One name for the whole table/ }));
    expect(screen.getByText("Known runs:")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Use the run name/ })).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Use the run name runB" }));
    expect(store.getState().draft.readCounts.runName).toMatchObject({
      mode: "fixed",
      fixedName: "runB",
    });
    expect(store.getState().draft.microhaplotypes.runName.mode).toBe("none");
    expect(screen.queryByRole("button", { name: "Use the run name runB" })).toBeNull();
  });

  it("suggests the column that looks like a run name", async () => {
    const { user, store } = await setup("microhaplotypes", []);
    await user.click(await screen.findByRole("radio", { name: /Read it from a column/ }));
    expect(store.getState().draft.microhaplotypes.runName).toMatchObject({
      mode: "column",
      column: "run",
    });
    expect(await screen.findByText(/2 runs: runA, runB\./)).toBeInTheDocument();
  });
});
