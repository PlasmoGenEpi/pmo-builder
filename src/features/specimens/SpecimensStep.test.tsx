import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { exampleFile, renderWithStore, textFile } from "@/features/shared/testing";

import { SpecimensStep } from "./SpecimensStep";

async function upload(file: File) {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<SpecimensStep />);
  await user.upload(screen.getByLabelText("Choose specimen table file"), file);
  await screen.findByRole("heading", { name: "Match columns" });
  return rendered;
}

describe("SpecimensStep", () => {
  it("says what a specimen is and that the step is optional before a file is added", async () => {
    const { store } = await renderWithStore(<SpecimensStep />);
    await act(() => store.getState().actions.flush());
    expect(screen.getByText(/A specimen is the physical sample/)).toBeInTheDocument();
    expect(screen.getByText(/one specimen can have several library samples/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Library samples step" })).toHaveAttribute(
      "href",
      "/library-samples",
    );
    const result = screen.getByRole("region", { name: "Result" });
    expect(within(result).getByText(/This step is optional/)).toBeInTheDocument();
  });

  it("builds the example metadata and shows specimens, countries, dates and projects", async () => {
    await upload(exampleFile("mad4hatter_metadata_example.tsv"));
    const result = screen.getByRole("region", { name: "Result" });
    expect(
      await within(result).findByText("This part is ready to go into the PMO."),
    ).toBeInTheDocument();
    expect(within(result).getByText("Specimens")).toBeInTheDocument();
    expect(await within(result).findByText("Country")).toBeInTheDocument();
    expect(within(result).getByText("Mozambique")).toBeInTheDocument();
    expect(within(result).getByText("Collected")).toBeInTheDocument();
    expect(within(result).getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Projects named in this table")).toBeVisible();
    expect(screen.getByText(/The Project step has no projects yet/)).toBeInTheDocument();
  });

  it("names the rows when a taxon ID is not a number", async () => {
    await upload(textFile("specimens.csv", "specimen_id,samp_taxon_id\nS1,5833\nS2,falciparum\n"));
    const result = screen.getByRole("region", { name: "Result" });
    expect(await within(result).findByText(/problems to fix/)).toBeInTheDocument();
    expect(within(result).getByText(/falciparum/)).toBeInTheDocument();
  });
});
