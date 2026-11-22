import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { getFieldSet } from "@/domain/fields";
import { setSlotTable, type MappedTable } from "@/domain/draft";
import { renderWithStore } from "@/features/shared/testing";
import { describeMapping } from "./mappingModel";
import type { ColumnMatching } from "./useColumnMatching";
import { TableFile } from "./TableFile";
import { TablePreviewPanel } from "./TablePreviewPanel";

function makeMatching(options: {
  readonly rowCount: number;
  readonly totalRows: number | null;
}): ColumnMatching {
  const rows = Array.from({ length: options.rowCount }, (_, index) => ({
    SampleID: `S${index}`,
    Target: `T${index}`,
    Seq: "ACGT",
    Reads: "10",
  }));
  const fieldSet = getFieldSet("microhaplotypes");
  const mapped: MappedTable = {
    table: {
      id: "t-stream",
      fileName: "big_alleles.csv",
      fileSize: 5_000_000,
      format: "delimited",
      sheetNames: null,
      sheetName: null,
      columns: ["SampleID", "Target", "Seq", "Reads"],
      rowCount: options.totalRows,
    },
    mapping: {
      fields: {
        librarySampleName: "SampleID",
        targetName: "Target",
        seq: "Seq",
        reads: "Reads",
      },
      additionalColumns: [],
    },
  };
  const model = describeMapping({
    tableId: mapped.table.id,
    fieldSet,
    columns: mapped.table.columns,
    mapping: mapped.mapping,
    matches: {},
    confirmed: new Set(),
    problems: [],
  });
  return {
    slot: { section: "microhaplotypes" },
    fieldSet,
    mapped,
    model,
    examples: { SampleID: "S0", Target: "T0", Seq: "ACGT", Reads: "10" },
    preview: {
      kind: "ready",
      columns: ["SampleID", "Target", "Seq", "Reads"],
      rows,
      offset: 0,
      totalRows: options.totalRows,
    },
    setField: () => undefined,
    confirm: () => undefined,
    setAdditionalColumns: () => undefined,
  };
}

describe("TablePreviewPanel with streamed totalRows", () => {
  it("shows a localized plural summary when totalRows is null", async () => {
    const user = userEvent.setup();
    await renderWithStore(
      <TablePreviewPanel
        matching={makeMatching({ rowCount: 50, totalRows: null })}
        label="Allele table"
      />,
    );
    const toggle = screen.getByRole("button", { name: /Preview/ });
    expect(toggle).toHaveTextContent("First 50 rows");
    await user.click(toggle);
    expect(
      screen.getByText("First 50 rows. Highlighted columns are matched to a field."),
    ).toBeInTheDocument();
  });

  it("uses the singular form when only 1 preview row is shown and totalRows is null", async () => {
    await renderWithStore(
      <TablePreviewPanel
        matching={makeMatching({ rowCount: 1, totalRows: null })}
        label="Allele table"
      />,
    );
    expect(screen.getByRole("button", { name: /Preview/ })).toHaveTextContent("First 1 row");
  });
});

describe("TableFile with streamed rowCount", () => {
  it("omits the row count when rowCount is null until microhaplotypes summary rows arrive", async () => {
    const slot = { section: "microhaplotypes" } as const;
    const { store } = await renderWithStore(
      <TableFile slot={slot} label="Allele table" description="One row per allele." />,
    );
    const mapped: MappedTable = {
      table: {
        id: "streamed-1",
        fileName: "huge.csv.gz",
        fileSize: 2_000_000,
        format: "delimited",
        sheetNames: null,
        sheetName: null,
        columns: ["SampleID", "Target", "Seq", "Reads"],
        rowCount: null,
      },
      mapping: { fields: {}, additionalColumns: [] },
    };
    act(() => {
      store.setState({ draft: setSlotTable(store.getState().draft, slot, mapped) });
    });

    expect(screen.getByText("huge.csv.gz")).toBeInTheDocument();
    expect(screen.getByText(/4 columns/)).toBeInTheDocument();
    expect(screen.queryByText(/rows/)).toBeNull();

    // Once the microhaplotypes build completes, TableFile shows the exact row count from the summary.
    await act(() => store.getState().actions.flush());
    const view = store.getState().build.view;
    if (view === null) throw new Error("expected build view");
    act(() => {
      store.setState({
        build: {
          phase: "idle",
          view: {
            ...view,
            sections: {
              ...view.sections,
              microhaplotypes: {
                status: "ready",
                notices: [],
                summary: {
                  rows: 25_000,
                  librarySamples: 50,
                  targets: 100,
                  microhaplotypes: 300,
                  runNames: [],
                },
              },
            },
          },
        },
      });
    });

    expect(screen.getByText(/25,000 rows/)).toBeInTheDocument();
  });
});
