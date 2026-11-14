import { act, cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  createDraftStorage,
  createMemoryBackend,
  getSlotTable,
  type KeyValueBackend,
  type StoreName,
} from "@/domain/draft";
import { importFailureMessage } from "@/domain/import/messages";
import { createTestStore, exampleFile, renderWithStore, textFile } from "@/features/shared/testing";

import { TableImport } from "./TableImport";

const SLOT = { section: "microhaplotypes" } as const;

async function setup(file: File) {
  const user = userEvent.setup();
  const rendered = await renderWithStore(
    <TableImport slot={SLOT} label="Allele table" description="One row for each allele." />,
  );
  await user.upload(screen.getByLabelText("Choose allele table file"), file);
  await screen.findByRole("heading", { name: "Match columns" });
  const mapping = () => getSlotTable(rendered.store.getState().draft, SLOT)?.mapping;
  return { ...rendered, user, mapping };
}

describe("TableImport", () => {
  it("matches the example's columns and says so in one line", async () => {
    await setup(exampleFile("mad4hatter_allele_data_example.csv"));
    expect(screen.getByText(/4 of 4 required fields matched/)).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Library sample name" })).toHaveValue("SampleID");
    expect(screen.getByText("mad4hatter_allele_data_example.csv")).toBeInTheDocument();
  });

  it("changes a field, and shows an error on a required field left unmatched", async () => {
    const { user, mapping } = await setup(exampleFile("mad4hatter_allele_data_example.csv"));
    const reads = screen.getByRole("combobox", { name: "Reads" });
    await user.click(reads);
    await user.click(await screen.findByRole("option", { name: "Not in this table" }));

    expect(mapping()?.fields["reads"]).toBeNull();
    expect(reads).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("Choose a column. This field is needed to build the table."),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 of 4 required fields matched/)).toBeInTheDocument();

    await user.click(reads);
    await user.type(reads, "Reads{Enter}");
    expect(mapping()?.fields["reads"]).toBe("Reads");
    expect(reads).not.toHaveAttribute("aria-invalid");
  });

  it("flags a column used twice on both rows", async () => {
    const { user } = await setup(exampleFile("mad4hatter_allele_data_example.csv"));
    const target = screen.getByRole("combobox", { name: "Target name" });
    await user.click(target);
    await user.type(target, "SampleID{Enter}");
    expect(screen.getAllByText(/"SampleID" is also chosen for/)).toHaveLength(2);
  });

  it("asks to check a match made from a similar name until it is kept", async () => {
    await setup(
      textFile(
        "alleles.csv",
        "Library sampl name,Target,Sequence,Reads\ns1,t1,ACGT,10\ns2,t1,ACGA,4\n",
      ),
    );
    expect(screen.getByText(/1 match to check/)).toBeInTheDocument();
    const note = screen.getByText("Matched by a similar name. Check it is right.");
    expect(note).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Library sample name: keep this match" }),
    );
    expect(screen.queryByText("Matched by a similar name. Check it is right.")).toBeNull();
    expect(screen.queryByText(/to check/)).toBeNull();
  });

  it("keeps a confirmed match in the draft, so a new tab does not ask again", async () => {
    const backends = new Map<StoreName, KeyValueBackend>();
    const openBackend = (name: StoreName): KeyValueBackend => {
      const backend = backends.get(name) ?? createMemoryBackend();
      backends.set(name, backend);
      return backend;
    };
    const first = createTestStore({ storage: createDraftStorage({ openBackend }) });
    await renderWithStore(
      <TableImport slot={SLOT} label="Allele table" description="One row for each allele." />,
      { store: first },
    );
    await userEvent.upload(
      screen.getByLabelText("Choose allele table file"),
      textFile("alleles.csv", "Library sampl name,Target,Sequence,Reads\ns1,t1,ACGT,10\n"),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Library sample name: keep this match" }),
    );
    expect(getSlotTable(first.getState().draft, SLOT)?.confirmedMatches).toEqual({
      librarySampleName: "Library sampl name",
    });
    await act(() => first.getState().actions.flush());
    cleanup();

    // Another tab: the draft comes back from storage with the confirmation.
    const second = createTestStore({ storage: createDraftStorage({ openBackend }) });
    await renderWithStore(
      <TableImport slot={SLOT} label="Allele table" description="One row for each allele." />,
      { store: second },
    );
    await screen.findByRole("heading", { name: "Match columns" });
    expect(screen.queryByText(/to check/)).toBeNull();
    expect(window.sessionStorage.length).toBe(0);
  });

  it("filters the optional fields", async () => {
    const { user } = await setup(exampleFile("mad4hatter_allele_data_example.csv"));
    await user.click(screen.getByRole("button", { name: /Optional fields/ }));
    expect(screen.getByRole("combobox", { name: "Chromosome" })).toBeInTheDocument();
    await user.type(screen.getByRole("searchbox", { name: "Filter optional fields" }), "strand");
    expect(screen.getByRole("combobox", { name: "Strand" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Pseudo-CIGAR strand" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Chromosome" })).toBeNull();
    await user.clear(screen.getByRole("searchbox", { name: "Filter optional fields" }));
    await user.type(screen.getByRole("searchbox", { name: "Filter optional fields" }), "zzz");
    expect(screen.getByText(/No optional field matches/)).toBeInTheDocument();
  });

  it("carries extra columns into the PMO, with select all and none", async () => {
    const { user, mapping } = await setup(
      textFile("alleles.csv", "sample,target,sequence,reads,notes,batch\ns1,t1,ACGT,10,ok,b1\n"),
    );
    const extra = screen.getByRole("button", { name: /Extra columns/ });
    expect(extra).toHaveTextContent("0 of 2 included");
    await user.click(extra);
    await user.click(screen.getByRole("checkbox", { name: "notes" }));
    expect(mapping()?.additionalColumns).toEqual(["notes"]);
    await user.click(screen.getByRole("button", { name: "Select all" }));
    expect(mapping()?.additionalColumns).toEqual(["notes", "batch"]);
    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(mapping()?.additionalColumns).toEqual([]);
  });

  it.each([
    [
      "empty.csv",
      new File([""], "empty.csv"),
      /"empty.csv" is empty\. Choose a file with a header/,
    ],
    [
      "header only",
      textFile("alleles.csv", "sample,target\n"),
      /"alleles.csv" has a header row but no rows of data\. Add the data/,
    ],
    [
      "an old .xls",
      new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])], "old.xls"),
      /old Excel file \(\.xls\).*save.*\.xlsx/i,
    ],
    [
      "another type",
      textFile("alleles.json", "{}"),
      /"alleles.json" is not a type of file that can be read\. Choose a \.csv, \.tsv, \.txt or \.xlsx file/,
    ],
    [
      "a damaged .gz",
      new File([new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3])], "alleles.csv.gz"),
      /could not be unpacked, so it may be damaged/,
    ],
    [
      "a damaged workbook",
      new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4])], "alleles.xlsx"),
      /could not be read as an Excel workbook, so it may be damaged/,
    ],
  ])("says what to do when the file is %s", async (_, file, expected) => {
    const { store } = await renderWithStore(
      <TableImport slot={SLOT} label="Allele table" description="One row for each allele." />,
    );
    await act(() => store.getState().actions.importFile(SLOT, file));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(expected));
    // The file is named once.
    expect((alert.textContent ?? "").split(file.name)).toHaveLength(2);
    expect(store.getState().imports["microhaplotypes"]).toMatchObject({
      kind: "failed",
      fileName: file.name,
    });
  });

  it("words the reasons that cannot be shown with a small file", () => {
    expect(
      importFailureMessage({ code: "missing-sheet", detail: { kind: "none" } }, "b.xlsx"),
    ).toBe('That sheet is not in "b.xlsx" any more. Choose another sheet, or add the file again.');
    expect(
      importFailureMessage(
        {
          code: "too-large",
          detail: { kind: "too-large", measure: "text", limitBytes: 300 * 1024 * 1024 },
        },
        "big.csv",
      ),
    ).toMatch(
      /"big.csv" is too large to open in the browser \(the limit is 300 MB of text\)\. Split it/,
    );
    expect(importFailureMessage({ code: "engine-stopped" }, "big.csv")).toMatch(
      /stopped while reading "big.csv".*Try a smaller file/,
    );
  });
});
