import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import { SortableTable, type SortableColumn } from "./SortableTable";

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

  it("applies cellStyle to valued cells, leaves missing cells unshaded, and keeps the chosen row marked", async () => {
    const user = userEvent.setup();
    const shadedColumns: readonly SortableColumn<TargetRow>[] = [
      { key: "name", label: "Target", value: (row) => row.name },
      {
        key: "heterozygosity",
        label: "Heterozygosity",
        value: (row) => row.heterozygosity,
        render: (row) => (row.heterozygosity === null ? "–" : row.heterozygosity.toFixed(2)),
        cellStyle: (row) =>
          row.heterozygosity === null ? undefined : { backgroundColor: "rgb(158, 197, 244)" },
        numeric: true,
      },
    ];

    function SelectableShadedTargets() {
      const [selected, setSelected] = useState<string>("t-high");
      return (
        <SortableTable
          label="Shaded targets"
          columns={shadedColumns}
          rows={TARGET_ROWS}
          rowKey={(row) => row.name}
          onRowSelect={(row) => setSelected(row.name)}
          selectedKey={selected}
        />
      );
    }

    render(<SelectableShadedTargets />);
    const table = screen.getByRole("table", { name: "Shaded targets" });
    const rows = within(table).getAllByRole("row").slice(1);
    const emptyRow = rows.find((row) => within(row).queryByText("t-empty-a") !== null);
    const highRow = rows.find((row) => within(row).queryByText("t-high") !== null);
    if (emptyRow === undefined || highRow === undefined) throw new Error("Expected test rows");

    const emptyValueCell = within(emptyRow).getAllByRole("cell")[1];
    const highValueCell = within(highRow).getAllByRole("cell")[1];
    if (emptyValueCell === undefined || highValueCell === undefined) {
      throw new Error("Expected value cells");
    }

    expect(emptyValueCell).toHaveTextContent("–");
    expect(emptyValueCell.style.backgroundColor).toBe("");
    expect(highValueCell).toHaveTextContent("0.85");
    expect(highValueCell.style.backgroundColor).toBe("rgb(158, 197, 244)");

    // The chosen row is marked on the row itself and on its target button.
    expect(highRow).toHaveAttribute("data-selected", "true");
    expect(emptyRow).not.toHaveAttribute("data-selected");
    expect(
      within(highRow).getByRole("button", { name: "t-high", pressed: true }),
    ).toBeInTheDocument();

    // Choosing another row by clicking its shaded cell moves the mark.
    await user.click(within(table).getByText("0.50"));
    expect(within(table).getByRole("button", { name: "t-mid", pressed: true })).toBeInTheDocument();
    expect(highRow).not.toHaveAttribute("data-selected");
  });
});
