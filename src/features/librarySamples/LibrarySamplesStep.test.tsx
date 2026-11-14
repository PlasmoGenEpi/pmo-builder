import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { exampleFile, renderWithStore, textFile } from "@/features/shared/testing";

import { LibrarySamplesStep } from "./LibrarySamplesStep";

describe("LibrarySamplesStep", () => {
  it("explains the links to other steps and that the step is optional before a file is added", async () => {
    const { store } = await renderWithStore(<LibrarySamplesStep />);
    await act(() => store.getState().actions.flush());
    expect(screen.getByText(/A specimen sequenced twice has two library samples/)).toBeVisible();
    expect(screen.getByText(/must match the name of a panel on the Panel/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Specimens step" })).toHaveAttribute(
      "href",
      "/specimens",
    );
    expect(screen.queryByRole("heading", { name: "What this table refers to" })).toBeNull();
    const result = screen.getByRole("region", { name: "Result" });
    expect(within(result).getByText(/This step is optional/)).toBeInTheDocument();
  });

  it("builds the example metadata and lists the panels and runs it names", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<LibrarySamplesStep />);
    await act(async () => {
      await store
        .getState()
        .actions.importFile(
          { section: "specimens" },
          exampleFile("mad4hatter_metadata_example.tsv"),
        );
    });
    await user.upload(
      screen.getByLabelText("Choose library sample table file"),
      exampleFile("mad4hatter_metadata_example.tsv"),
    );
    const result = screen.getByRole("region", { name: "Result" });
    expect(
      await within(result).findByText("This part is ready to go into the PMO."),
    ).toBeInTheDocument();
    expect(within(result).getByText("Library samples")).toBeInTheDocument();
    expect(within(result).getByText("Panel")).toBeInTheDocument();

    const links = screen.getByRole("region", { name: "What this table refers to" });
    expect(within(links).getByText("Mad4hatter")).toBeInTheDocument();
    expect(within(links).getByText("run1")).toBeInTheDocument();
    expect(await within(links).findByText("All found on the Specimens step.")).toBeVisible();
    expect(within(links).getByText("The Panel step has no named panels yet.")).toBeVisible();
    expect(within(links).getByRole("link", { name: "Go to Panel" })).toHaveAttribute(
      "href",
      "/panel",
    );
  });

  it("names the specimens that are not on the Specimens step", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<LibrarySamplesStep />);
    await act(async () => {
      await store
        .getState()
        .actions.importFile(
          { section: "specimens" },
          textFile("specimens.csv", "specimen_id,country\nS1,Mali\n"),
        );
    });
    await user.upload(
      screen.getByLabelText("Choose library sample table file"),
      textFile(
        "libraries.csv",
        "library_sample_id,specimen_id,panel_id\nL1,S1,P1\nL2,S2,P1\nL3,S3,P1\n",
      ),
    );
    const links = await screen.findByRole("region", { name: "What this table refers to" });
    expect(await within(links).findByText("Not on the Specimens step: S2, S3.")).toBeVisible();
  });
});
