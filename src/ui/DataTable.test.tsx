import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { i18n } from "@/i18n";

import { DataTable } from "./DataTable";

const COLUMNS = ["SampleID", "Locus", "Reads", "Notes"];
const ROWS = [
  { SampleID: "example_sample_47", Locus: "Pf3D7_01_v3-145388-145662-1A", Reads: 13, Notes: null },
  { SampleID: "example_sample_08", Locus: "Pf3D7_01_v3-145388-145662-1A", Reads: 4, Notes: "  " },
];

/** `<Trans>` needs the i18n context, as in the app. */
function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

describe("DataTable", () => {
  it("says how much of the table it shows", () => {
    render(<DataTable label="Preview" columns={COLUMNS} rows={ROWS} totalRows={12431} />, {
      wrapper,
    });
    expect(screen.getByText("Showing 2 of 12,431 rows")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preview" })).toHaveAccessibleDescription(
      "Showing 2 of 12,431 rows",
    );
  });

  it("gives the plain row count when it shows the whole table", () => {
    render(<DataTable label="Preview" columns={COLUMNS} rows={ROWS} totalRows={2} />, { wrapper });
    expect(screen.getByText("2 rows")).toBeInTheDocument();
  });

  it("labels highlighted columns with the field they are mapped to", () => {
    render(
      <DataTable
        label="Preview"
        columns={COLUMNS}
        rows={ROWS}
        highlightedColumns={{ Locus: "Target name" }}
      />,
      { wrapper },
    );
    const headers = screen.getAllByRole("columnheader");
    const locus = headers.find((header) => header.textContent?.startsWith("Locus"));
    expect(locus).toHaveTextContent("Locusmapped to Target name");
    const sample = headers.find((header) => header.textContent?.startsWith("SampleID"));
    expect(sample).not.toHaveTextContent("mapped to");
  });

  it("numbers rows, marks blank cells and keeps full values on hover", () => {
    render(<DataTable label="Preview" columns={COLUMNS} rows={ROWS} />, { wrapper });
    const rows = screen.getAllByRole("row").slice(1);
    const first = rows[0];
    if (first === undefined) throw new Error("No rows");
    expect(within(first).getByRole("rowheader")).toHaveTextContent("1");
    expect(within(first).getByText("blank")).toBeInTheDocument();
    expect(within(first).getByText("Pf3D7_01_v3-145388-145662-1A")).toHaveAttribute(
      "title",
      "Pf3D7_01_v3-145388-145662-1A",
    );
    // A cell of only spaces counts as blank too.
    expect(within(rows[1] ?? first).getByText("blank")).toBeInTheDocument();
  });
});
