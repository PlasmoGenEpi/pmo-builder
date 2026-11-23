import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveFile } from "@/features/review/saveFile";

import { buttonClassName } from "@/ui";

import { SortableTable, type SortableColumn, type TableScrollRequest } from "./SortableTable";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));

beforeEach(() => {
  vi.mocked(saveFile).mockReset();
});

interface TargetRow {
  readonly name: string;
  readonly heterozygosity: number | null;
}

const TARGET_COLUMNS: readonly SortableColumn<TargetRow>[] = [
  { key: "name", label: "Target", value: (row) => row.name },
  {
    key: "heterozygosity",
    label: "Heterozygosity",
    value: (row) => row.heterozygosity,
    render: (row) => (row.heterozygosity === null ? "–" : row.heterozygosity.toFixed(2)),
    numeric: true,
  },
];

const TARGET_ROWS: readonly TargetRow[] = [
  { name: "t-empty-a", heterozygosity: null },
  { name: "t-mid", heterozygosity: 0.5 },
  { name: "t-empty-b", heterozygosity: null },
  { name: "t-high", heterozygosity: 0.85 },
  { name: "t-low", heterozygosity: 0.1 },
];

function firstColumnValues(table: HTMLElement): string[] {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

function SelectableTargets() {
  const [selected, setSelected] = useState<string>("t-mid");
  return (
    <SortableTable
      label="Targets"
      columns={TARGET_COLUMNS}
      rows={TARGET_ROWS}
      rowKey={(row) => row.name}
      onRowSelect={(row) => setSelected(row.name)}
      selectedKey={selected}
    />
  );
}

describe("SortableTable", () => {
  it("keeps rows with missing numeric values last when sorting descending and ascending", async () => {
    const user = userEvent.setup();
    render(
      <SortableTable
        label="Targets"
        columns={TARGET_COLUMNS}
        rows={TARGET_ROWS}
        rowKey={(row) => row.name}
      />,
    );
    const table = screen.getByRole("table", { name: "Targets" });
    const sortButton = within(table).getByRole("button", { name: "Sort by Heterozygosity" });

    // Numeric columns start descending on first click: highest real values first, empty rows last.
    await user.click(sortButton);
    expect(within(table).getByRole("columnheader", { name: /Heterozygosity/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(firstColumnValues(table)).toEqual([
      "t-high",
      "t-mid",
      "t-low",
      "t-empty-a",
      "t-empty-b",
    ]);

    // Clicking again switches to ascending: lowest real values first, empty rows still last.
    await user.click(sortButton);
    expect(within(table).getByRole("columnheader", { name: /Heterozygosity/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    expect(firstColumnValues(table)).toEqual([
      "t-low",
      "t-mid",
      "t-high",
      "t-empty-a",
      "t-empty-b",
    ]);
  });

  it("keeps missing values last on initial descending sort and on text columns", async () => {
    const user = userEvent.setup();
    interface GroupRow {
      readonly id: string;
      readonly name: string | null;
      readonly score: number | null;
    }
    const columns: readonly SortableColumn<GroupRow>[] = [
      {
        key: "name",
        label: "Group",
        value: (row) => row.name,
        render: (row) => row.name ?? "Not recorded",
      },
      { key: "score", label: "Score", value: (row) => row.score, numeric: true },
    ];
    const rows: readonly GroupRow[] = [
      { id: "none", name: null, score: null },
      { id: "b", name: "Beta", score: 2 },
      { id: "a", name: "Alpha", score: 5 },
    ];

    render(
      <SortableTable
        label="Groups"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        initialSort={{ key: "score", descending: true }}
      />,
    );
    const table = screen.getByRole("table", { name: "Groups" });
    expect(firstColumnValues(table)).toEqual(["Alpha", "Beta", "Not recorded"]);

    const sortByGroup = within(table).getByRole("button", { name: "Sort by Group" });
    // Text columns start ascending on first click.
    await user.click(sortByGroup);
    expect(firstColumnValues(table)).toEqual(["Alpha", "Beta", "Not recorded"]);

    // Second click reverses to descending, still keeping missing ("Not recorded") last.
    await user.click(sortByGroup);
    expect(firstColumnValues(table)).toEqual(["Beta", "Alpha", "Not recorded"]);
  });

  it("exposes a keyboard-focusable scroll region with the table's accessible name", async () => {
    const user = userEvent.setup();
    render(
      <SortableTable
        label="Targets"
        columns={TARGET_COLUMNS}
        rows={TARGET_ROWS}
        rowKey={(row) => row.name}
      />,
    );

    const scrollRegion = screen.getByRole("region", { name: "Targets" });
    expect(within(scrollRegion).getByRole("table", { name: "Targets" })).toBeInTheDocument();

    await user.tab();
    expect(scrollRegion).toHaveFocus();
  });

  it("announces the chosen row via aria-pressed on its button and omits aria-selected on table rows", async () => {
    const user = userEvent.setup();

    render(<SelectableTargets />);
    const table = screen.getByRole("table", { name: "Targets" });

    expect(within(table).getByRole("button", { name: "t-mid", pressed: true })).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "t-high", pressed: false }),
    ).toBeInTheDocument();
    for (const row of within(table).getAllByRole("row")) {
      expect(row).not.toHaveAttribute("aria-selected");
    }

    await user.click(within(table).getByRole("button", { name: "t-high" }));
    expect(
      within(table).getByRole("button", { name: "t-high", pressed: true }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", { name: "t-mid", pressed: false }),
    ).toBeInTheDocument();

    await user.click(within(table).getByText("0.10"));
    expect(within(table).getByRole("button", { name: "t-low", pressed: true })).toBeInTheDocument();
  });

  it("hides search when a table has five or fewer rows, while still showing the count and download", async () => {
    const user = userEvent.setup();
    render(
      <SortableTable
        label="Targets"
        columns={TARGET_COLUMNS}
        rows={TARGET_ROWS}
        rowKey={(row) => row.name}
        searchableColumns={["name"]}
        download={{ fileName: "study-summary-targets", format: "csv" }}
      />,
    );

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.getByText("Showing 5 of 5 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download Targets as csv" }));
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, fileName] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(fileName).toBe("study-summary-targets.csv");
    expect(await blob?.text()).toBe(
      [
        "Target,Heterozygosity",
        "t-empty-a,",
        "t-mid,0.5",
        "t-empty-b,",
        "t-high,0.85",
        "t-low,0.1",
        "",
      ].join("\n"),
    );
  });

  it("searches named columns, updates the row count, clears the search and downloads only shown sorted rows", async () => {
    interface SampleRow {
      readonly name: string;
      readonly specimen: string | null;
      readonly note: string;
      readonly reads: number;
    }
    const columns: readonly SortableColumn<SampleRow>[] = [
      { key: "name", label: "Library sample", value: (row) => row.name },
      { key: "specimen", label: "Specimen", value: (row) => row.specimen },
      { key: "note", label: "Note", value: (row) => row.note },
      { key: "reads", label: "Reads", value: (row) => row.reads, numeric: true },
    ];
    const rows: readonly SampleRow[] = [
      { name: "LIB_01", specimen: "SPEC_KENYA_1", note: "alpha", reads: 120 },
      { name: "LIB_02", specimen: "SPEC_MALI_2", note: "beta", reads: 450 },
      { name: "LIB_03", specimen: "SPEC_KENYA_3", note: "gamma", reads: 300 },
      { name: "LIB_04", specimen: "SPEC_GHANA_4", note: "kenya-note", reads: 80 },
      { name: "LIB_05", specimen: null, note: "delta", reads: 60 },
      { name: "LIB_06", specimen: "SPEC_MALI_6", note: "epsilon", reads: 900 },
    ];
    const user = userEvent.setup();
    render(
      <SortableTable
        label="Samples"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.name}
        initialSort={{ key: "reads", descending: true }}
        searchableColumns={["name", "specimen"]}
        searchPlaceholder="Search sample or specimen"
        download={{ fileName: "study-summary-samples", format: "tsv" }}
      />,
    );

    const search = screen.getByRole("searchbox", { name: "Search Samples" });
    expect(search).toHaveAttribute("placeholder", "Search sample or specimen");
    expect(screen.getByText("Showing 6 of 6 rows")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Clear/ })).not.toBeInTheDocument();

    // Matches specimen column case-insensitively and ignores non-searchable "note" column.
    await user.type(search, "kenya");
    const table = screen.getByRole("table", { name: "Samples" });
    expect(firstColumnValues(table)).toEqual(["LIB_03", "LIB_01"]);
    expect(screen.getByText("Showing 2 of 6 rows")).toBeInTheDocument();

    // Download holds the two shown rows in current sorted order with on-screen headings in TSV.
    await user.click(screen.getByRole("button", { name: "Download Samples as tsv" }));
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, fileName] = vi.mocked(saveFile).mock.calls[0] ?? [];
    expect(fileName).toBe("study-summary-samples.tsv");
    expect(await blob?.text()).toBe(
      [
        "Library sample\tSpecimen\tNote\tReads",
        "LIB_03\tSPEC_KENYA_3\tgamma\t300",
        "LIB_01\tSPEC_KENYA_1\talpha\t120",
        "",
      ].join("\n"),
    );

    // Search with no matches shows empty message and disables download.
    await user.clear(search);
    await user.type(search, "no-such-sample");
    expect(screen.getByText("Showing 0 of 6 rows")).toBeInTheDocument();
    expect(screen.getByText("Nothing matches the search.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Samples as tsv" })).toBeDisabled();

    // Clear action restores all rows and focuses the search box.
    await user.click(screen.getByRole("button", { name: "Clear search for Samples" }));
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByText("Showing 6 of 6 rows")).toBeInTheDocument();
    expect(firstColumnValues(table)).toHaveLength(6);
  });

  it("uses the wrapping button variant for column headings and selectable row labels with sort indicators intact", () => {
    render(<SelectableTargets />);
    const table = screen.getByRole("table", { name: "Targets" });
    const wrappingClasses = buttonClassName({ variant: "ghost", size: "sm", wrap: true }).split(
      " ",
    );

    const headingButton = within(table).getByRole("button", { name: "Sort by Heterozygosity" });
    for (const name of wrappingClasses) {
      expect(headingButton).toHaveClass(name);
    }
    expect(headingButton).not.toHaveClass("h-auto!");
    expect(headingButton.querySelector("span")).toBeNull();
    expect(headingButton.querySelector('svg[aria-hidden="true"]')).not.toBeNull();

    const rowButton = within(table).getByRole("button", { name: "t-mid" });
    for (const name of wrappingClasses) {
      expect(rowButton).toHaveClass(name);
    }
    expect(rowButton).not.toHaveClass("h-auto!");
    expect(rowButton.querySelector("span")).toBeNull();
  });

  it("marks a selected row without onRowSelect, clears a hiding search, and scrolls it inside the table container", async () => {
    const user = userEvent.setup();
    const rows: readonly TargetRow[] = Array.from({ length: 8 }, (_, index) => ({
      name: `sample_${index + 1}`,
      heterozygosity: index * 0.1,
    }));

    function Harness() {
      const [selected, setSelected] = useState<string | null>(null);
      const [scrollToRow, setScrollToRow] = useState<TableScrollRequest | null>(null);
      return (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelected("sample_7");
              setScrollToRow((before) => ({ key: "sample_7", seq: (before?.seq ?? 0) + 1 }));
            }}
          >
            Jump to sample_7
          </button>
          <SortableTable
            label="Samples"
            columns={TARGET_COLUMNS}
            rows={rows}
            rowKey={(row) => row.name}
            selectedKey={selected}
            scrollToRow={scrollToRow}
            searchableColumns={["name"]}
          />
        </div>
      );
    }

    render(<Harness />);
    const scrollRegion = screen.getByRole("region", { name: "Samples" });
    const scrollToSpy = vi.fn<(options: ScrollToOptions) => void>();
    Object.defineProperty(scrollRegion, "scrollTo", { value: scrollToSpy, configurable: true });
    scrollRegion.getBoundingClientRect = () => ({
      top: 100,
      bottom: 220,
      left: 0,
      right: 400,
      width: 400,
      height: 120,
      x: 0,
      y: 100,
      toJSON: () => ({}),
    });

    // Narrow the search so sample_7 is hidden.
    const search = screen.getByRole("searchbox", { name: "Search Samples" });
    await user.type(search, "sample_1");
    expect(screen.queryByText("sample_7")).not.toBeInTheDocument();

    // Selecting sample_7 from outside clears the hiding search and marks the row.
    await user.click(screen.getByRole("button", { name: "Jump to sample_7" }));
    expect(search).toHaveValue("");
    const sample7Row = screen.getByText("sample_7").closest("tr");
    if (sample7Row === null) throw new Error("Expected sample_7 row");
    expect(sample7Row).toHaveAttribute("aria-current", "true");

    // Position the row below the scroll container viewport and re-trigger scrolling.
    sample7Row.getBoundingClientRect = () => ({
      top: 320,
      bottom: 350,
      left: 0,
      right: 400,
      width: 400,
      height: 30,
      x: 0,
      y: 320,
      toJSON: () => ({}),
    });
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn<(query: string) => MediaQueryList>().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addListener: vi.fn<() => void>(),
      removeListener: vi.fn<() => void>(),
      addEventListener: vi.fn<() => void>(),
      removeEventListener: vi.fn<() => void>(),
      dispatchEvent: vi.fn<() => boolean>(),
    });
    try {
      await user.click(screen.getByRole("button", { name: "Jump to sample_7" }));
    } finally {
      window.matchMedia = originalMatchMedia;
    }

    expect(scrollToSpy).toHaveBeenCalledWith({ top: 130, behavior: "auto" });
  });

  it("shows an outside totalRows denominator in the row count and updates cleanly with search", async () => {
    const user = userEvent.setup();
    const rows: readonly TargetRow[] = [
      { name: "Pf3D7_01", heterozygosity: 0.4 },
      { name: "Pf3D7_02", heterozygosity: 0.5 },
      { name: "Pf3D7_03", heterozygosity: 0.6 },
      { name: "Pf3D7_04", heterozygosity: 0.7 },
      { name: "Pf3D7_05", heterozygosity: 0.8 },
      { name: "Pf3D7_06", heterozygosity: 0.9 },
    ];
    render(
      <SortableTable
        label="Targets"
        columns={TARGET_COLUMNS}
        rows={rows}
        totalRows={276}
        rowKey={(row) => row.name}
        searchableColumns={["name"]}
      />,
    );

    expect(screen.getByText("Showing 6 of 276 rows")).toBeInTheDocument();

    const search = screen.getByRole("searchbox", { name: "Search Targets" });
    await user.type(search, "Pf3D7_01");
    expect(screen.getByText("Showing 1 of 276 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear search for Targets" }));
    expect(screen.getByText("Showing 6 of 276 rows")).toBeInTheDocument();
  });
});
