import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithStore } from "@/features/shared/testing";
import type { AppStore } from "@/state";

import { SequencingStep } from "./SequencingStep";

async function setup() {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<SequencingStep />);
  await act(() => rendered.store.getState().actions.flush());
  return { ...rendered, user };
}

const REQUIRED: readonly (readonly [RegExp, string])[] = [
  [/^Sequencing run name/, "run1"],
  [/^Platform/, "ILLUMINA"],
  [/^Instrument model/, "NextSeq 2000"],
  [/^Library layout/, "PAIRED"],
  [/^Library strategy/, "AMPLICON"],
  [/^Library source/, "GENOMIC"],
  [/^Library selection/, "PCR"],
];

/** Pretends the library sample table names these sequencing runs. */
function suggestSequencingNames(store: AppStore, names: readonly string[]): void {
  const view = store.getState().build.view;
  if (view === null) throw new Error("no build");
  act(() =>
    store.setState({
      build: {
        phase: "idle",
        view: { ...view, suggestions: { ...view.suggestions, sequencingNames: names } },
      },
    }),
  );
}

describe("SequencingStep", () => {
  it("starts with one blank run and says nothing is entered", async () => {
    await setup();
    expect(screen.getByRole("heading", { name: "Sequencing run 1" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing here yet\. Fill in a sequencing run/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Kit, dates and other details/ }),
    ).toBeInTheDocument();
  });

  it("reaches ready once the seven required fields are filled in", async () => {
    const { user } = await setup();
    for (const [name, value] of REQUIRED) {
      // oxlint-disable-next-line no-await-in-loop -- fields are typed one after another, as a user would
      await user.type(screen.getByLabelText(name), value);
    }
    await user.tab();
    expect(await screen.findByText("This part is ready to go into the PMO.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "run1" })).toBeInTheDocument();
  });

  it("suggests the usual INSDC terms and still takes free text", async () => {
    const { user, store } = await setup();
    const platform = screen.getByLabelText(/^Platform/);
    const listId = platform.getAttribute("list");
    expect(listId).not.toBeNull();
    const options = [...document.querySelectorAll(`datalist[id="${listId ?? ""}"] option`)].map(
      (option) => option.getAttribute("value"),
    );
    expect(options).toEqual(expect.arrayContaining(["ILLUMINA", "OXFORD_NANOPORE", "PACBIO_SMRT"]));
    const layout = screen.getByLabelText(/^Library layout/);
    expect(layout).toHaveAttribute("list");
    await user.type(platform, "My own platform");
    await user.tab();
    const run = store.getState().draft.sequencing.records[0];
    expect(run?.values.seq_platform).toBe("My own platform");
  });

  it("flags a date in the wrong format inline and in the result", async () => {
    const { user } = await setup();
    for (const [name, value] of REQUIRED) {
      // oxlint-disable-next-line no-await-in-loop -- fields are typed one after another, as a user would
      await user.type(screen.getByLabelText(name), value);
    }
    await user.click(screen.getByRole("button", { name: /Kit, dates and other details/ }));
    await user.type(screen.getByRole("textbox", { name: /^Sequencing date/ }), "15/01/2024");
    await user.tab();
    expect(
      screen.getAllByText(
        /Sequencing date is "15\/01\/2024", but it must be a date written YYYY-MM or YYYY-MM-DD\./,
      ),
    ).not.toHaveLength(0);
    expect(
      await screen.findByText(/There are problems to fix before this part can go into the PMO/),
    ).toBeInTheDocument();
  });

  it("offers a record for each run the library sample table names", async () => {
    const { user, store } = await setup();
    await user.type(screen.getByRole("textbox", { name: /^Sequencing run name/ }), "runA");
    await user.tab();
    await act(() => store.getState().actions.flush());
    suggestSequencingNames(store, ["runA", "runB", "runC"]);
    expect(
      screen.getByText("The library sample table names 2 sequencing runs with no record here"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a record for each" }));
    expect(
      store.getState().draft.sequencing.records.map((record) => record.values.sequencing_info_name),
    ).toEqual(["runA", "runB", "runC"]);
  });
});
