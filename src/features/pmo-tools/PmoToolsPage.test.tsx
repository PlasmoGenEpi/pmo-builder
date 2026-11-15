import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";
import { saveFile } from "@/features/review/saveFile";
import { createTestStore, renderWithStore } from "@/features/shared/testing";

import { PmoToolsPage } from "./PmoToolsPage";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));

const EXAMPLE = buildExamplePmo();

function pmoFile(data: unknown, name = "study.json"): File {
  return new File([typeof data === "string" ? data : stringifyPmo(data)], name);
}

async function open(file: File) {
  const user = userEvent.setup();
  await renderWithStore(<PmoToolsPage />, { store: createTestStore() });
  await user.upload(screen.getByLabelText("Choose pmo file"), file);
  return user;
}

async function savedText(): Promise<{ readonly name: string; readonly text: string }> {
  const call = vi.mocked(saveFile).mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing saved");
  const [blob, name] = call;
  return { name, text: await blob.text() };
}

beforeEach(() => {
  vi.mocked(saveFile).mockReset();
});

describe("PmoToolsPage", () => {
  it("opens a PMO and downloads its allele table as CSV", async () => {
    const user = await open(pmoFile(EXAMPLE));
    expect(await screen.findByRole("region", { name: "What is in the PMO" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-alleles.csv");
    expect(text.split("\n")[0]).toBe(
      "library_sample_name,target_name,seq,bioinformatics_run_name,reads",
    );
  });

  it("downloads a table as TSV", async () => {
    const user = await open(pmoFile(EXAMPLE));
    await screen.findByRole("region", { name: "What is in the PMO" });
    await user.click(screen.getByRole("radio", { name: "TSV" }));
    await user.click(screen.getByRole("button", { name: "Download Specimens as tsv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-specimens.tsv");
    expect(text.split("\n")[0]).toContain("\t");
  });

  it("makes a subset of ticked specimens and downloads it", async () => {
    const user = await open(pmoFile(EXAMPLE, "study.json.gz"));
    await screen.findByRole("region", { name: "What is in the PMO" });
    await user.click(screen.getByRole("tab", { name: "Make a subset" }));
    const make = screen.getByRole("button", { name: "Make the subset" });
    expect(make).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    const specimens = screen.getByRole("group", { name: "Specimens" });
    const boxes = within(specimens).getAllByRole("checkbox");
    // One click after another, as a person would tick them.
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(0, 3)) await user.click(box);
    expect(screen.getByText(/^3 of \d+ specimens kept\.$/)).toBeInTheDocument();
    await user.click(make);
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-subset.json");
    const subset: unknown = JSON.parse(text);
    expect(subset).toMatchObject({ specimen_info: expect.any(Array) });
    expect(JSON.parse(text).specimen_info).toHaveLength(3);
  });

  it("shows the subset's tables once it is made", async () => {
    const user = await open(pmoFile(EXAMPLE));
    await screen.findByRole("region", { name: "What is in the PMO" });
    await user.click(screen.getByRole("tab", { name: "Make a subset" }));
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "100");
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");
    await user.click(screen.getByRole("button", { name: "Download its tables" }));
    expect(screen.getByRole("radio", { name: "The subset" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-subset-alleles.csv");
    const reads = text
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((line) => Number(line.split(",").at(-1)));
    expect(Math.min(...reads)).toBeGreaterThanOrEqual(100);
  });

  it("says why a file of another version cannot be opened", async () => {
    const old = { ...EXAMPLE, pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" } };
    await open(pmoFile(old));
    expect(
      await screen.findByText(
        "This file is in PMO version 1.0.0. Only version 1.1.0 files can be opened here.",
      ),
    ).toBeInTheDocument();
  });
});
