import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { exampleFile, renderWithStore, textFile } from "@/features/shared/testing";

import { ReadCountsStep } from "./ReadCountsStep";

describe("ReadCountsStep", () => {
  it("explains the counts, asks for the totals first and keeps the by-stage table back", async () => {
    const { store } = await renderWithStore(<ReadCountsStep />);
    await act(() => store.getState().actions.flush());
    expect(screen.getByText(/how many reads each sample had/)).toBeInTheDocument();
    expect(screen.getByLabelText("Choose totals table file")).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose by-stage table file")).toBeNull();
    expect(screen.getByText(/Add the totals table first/)).toBeInTheDocument();
    const result = screen.getByRole("region", { name: "Result" });
    expect(within(result).getByText(/This step is optional/)).toBeInTheDocument();
  });

  it("builds the example totals and stages with a run name", async () => {
    const user = userEvent.setup();
    const { store } = await renderWithStore(<ReadCountsStep />);
    await user.upload(
      screen.getByLabelText("Choose totals table file"),
      exampleFile("example_raw_reads.txt"),
    );
    await user.upload(
      await screen.findByLabelText("Choose by-stage table file"),
      exampleFile("reads_per_stage.txt"),
    );
    await user.click(screen.getByRole("radio", { name: /One name for the whole table/ }));
    await user.type(screen.getByRole("textbox", { name: "Run name" }), "run_2024");

    const result = screen.getByRole("region", { name: "Result" });
    expect(
      await within(result).findByText("This part is ready to go into the PMO."),
    ).toBeInTheDocument();
    expect(within(result).getByText("With read counts")).toBeInTheDocument();
    expect(within(result).getByText("demux, dada2")).toBeInTheDocument();
    expect(await within(result).findByText("run_2024")).toBeInTheDocument();
    expect(store.getState().draft.readCounts.runName).toMatchObject({
      mode: "fixed",
      fixedName: "run_2024",
    });
  });

  it("names the row when a total is not a whole number", async () => {
    const user = userEvent.setup();
    await renderWithStore(<ReadCountsStep />);
    await user.upload(
      screen.getByLabelText("Choose totals table file"),
      textFile("totals.txt", "sample\traw_count\nS1\t10\nS2\tmany\n"),
    );
    const result = screen.getByRole("region", { name: "Result" });
    expect(await within(result).findByText(/problems to fix/)).toBeInTheDocument();
    expect(within(result).getByText(/many/)).toBeInTheDocument();
  });
});
