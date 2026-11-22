import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { CoverageGrid } from "./CoverageGrid";
import { dataset } from "./testing";

beforeAll(installDomPolyfills);

function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const SAMPLE_DATASETS = [
  dataset({
    id: "1",
    countries: ["Kenya"],
    collectionYears: { first: 2019, last: 2020 },
    summary: { ...dataset({ id: "0" }).summary, specimens: 400 },
  }),
  dataset({
    id: "2",
    countries: ["Kenya"],
    collectionYears: { first: 2020, last: 2020 },
    summary: { ...dataset({ id: "0" }).summary, specimens: 840 },
  }),
  dataset({
    id: "3",
    countries: ["Uganda"],
    collectionYears: { first: 2021, last: 2021 },
    summary: { ...dataset({ id: "0" }).summary, specimens: 150 },
  }),
];

describe("CoverageGrid", () => {
  it("starts collapsed with a summary and expands to show countries, years, legend and accessible cell figures", async () => {
    const user = userEvent.setup();
    render(
      <CoverageGrid
        datasets={SAMPLE_DATASETS}
        selectedCountries={[]}
        selectedYear={null}
        onSelectCell={vi.fn<(country: string, year: number) => void>()}
      />,
      { wrapper },
    );

    const toggle = screen.getByRole("button", { name: /Coverage by country and year/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveTextContent("2 countries, 2019 to 2021");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    const grid = screen.getByRole("table", { name: "Specimens by country and collection year" });
    expect(within(grid).getByRole("columnheader", { name: "Country" })).toBeInTheDocument();
    expect(within(grid).getByRole("columnheader", { name: "2019" })).toBeInTheDocument();
    expect(within(grid).getByRole("columnheader", { name: "2020" })).toBeInTheDocument();
    expect(within(grid).getByRole("columnheader", { name: "2021" })).toBeInTheDocument();
    expect(within(grid).getByRole("rowheader", { name: "Kenya" })).toBeInTheDocument();
    expect(within(grid).getByRole("rowheader", { name: "Uganda" })).toBeInTheDocument();

    // Every cell exposes its figure as text, not colour alone.
    expect(
      within(grid).getByRole("button", { name: "Kenya, 2019: 400 specimens in 1 published PMO" }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", {
        name: "Kenya, 2020: 1,240 specimens in 2 published PMOs",
      }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: "Kenya, 2021: 0 specimens" }),
    ).toBeInTheDocument();
    expect(
      within(grid).getByRole("button", { name: "Uganda, 2021: 150 specimens in 1 published PMO" }),
    ).toBeInTheDocument();

    // Legend shows empty swatch and log-scale upper bound.
    expect(screen.getByText("0 specimens")).toBeInTheDocument();
    expect(screen.getByText("1,240 specimens (log scale)")).toBeInTheDocument();
  });

  it("updates the readout on hover and focus, marks the active cell, and calls onSelectCell", async () => {
    const user = userEvent.setup();
    const onSelectCell = vi.fn<(country: string, year: number) => void>();
    render(
      <CoverageGrid
        datasets={SAMPLE_DATASETS}
        selectedCountries={["Kenya"]}
        selectedYear={2020}
        onSelectCell={onSelectCell}
        defaultOpen
      />,
      { wrapper },
    );

    const activeCell = screen.getByRole("button", {
      name: "Kenya, 2020: 1,240 specimens in 2 published PMOs",
    });
    expect(activeCell).toHaveAttribute("aria-pressed", "true");

    // Readout starts with the selected cell's figures.
    const readout = screen.getByTestId("coverage-readout");
    expect(readout).toHaveTextContent("Kenya, 2020: 1,240 specimens in 2 published PMOs");

    const uganda2021 = screen.getByRole("button", {
      name: "Uganda, 2021: 150 specimens in 1 published PMO",
    });
    expect(uganda2021).toHaveAttribute("aria-pressed", "false");

    await user.hover(uganda2021);
    expect(readout).toHaveTextContent("Uganda, 2021: 150 specimens in 1 published PMO");

    await user.click(uganda2021);
    expect(onSelectCell).toHaveBeenCalledWith("Uganda", 2021);
  });

  it("reaches every cell with arrow keys and chooses the focused cell with Enter", async () => {
    const user = userEvent.setup();
    const onSelectCell = vi.fn<(country: string, year: number) => void>();
    render(
      <CoverageGrid
        datasets={SAMPLE_DATASETS}
        selectedCountries={[]}
        selectedYear={null}
        onSelectCell={onSelectCell}
        defaultOpen
      />,
      { wrapper },
    );

    const grid = screen.getByRole("table");
    const cells = within(grid).getAllByRole("button");
    // Only one cell is in the Tab order at a time (roving tabindex).
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);

    const firstCell = screen.getByRole("button", {
      name: "Kenya, 2019: 400 specimens in 1 published PMO",
    });
    firstCell.focus();
    expect(firstCell).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(
      screen.getByRole("button", { name: "Kenya, 2020: 1,240 specimens in 2 published PMOs" }),
    ).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("button", { name: "Uganda, 2020: 0 specimens" })).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    const uganda2021 = screen.getByRole("button", {
      name: "Uganda, 2021: 150 specimens in 1 published PMO",
    });
    expect(uganda2021).toHaveFocus();
    expect(screen.getByTestId("coverage-readout")).toHaveTextContent(
      "Uganda, 2021: 150 specimens in 1 published PMO",
    );

    await user.keyboard("{Enter}");
    expect(onSelectCell).toHaveBeenCalledWith("Uganda", 2021);

    // Home and End jump to the first and last year in the current row.
    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "Uganda, 2019: 0 specimens" })).toHaveFocus();

    await user.keyboard("{End}");
    expect(uganda2021).toHaveFocus();

    await user.keyboard("{ArrowUp}");
    expect(screen.getByRole("button", { name: "Kenya, 2021: 0 specimens" })).toHaveFocus();

    await user.keyboard("{ArrowLeft}");
    expect(
      screen.getByRole("button", { name: "Kenya, 2020: 1,240 specimens in 2 published PMOs" }),
    ).toHaveFocus();
  });

  it("shows an empty note when active filters leave no country and year data", async () => {
    render(
      <CoverageGrid
        datasets={[]}
        selectedCountries={[]}
        selectedYear={null}
        onSelectCell={vi.fn<(country: string, year: number) => void>()}
        defaultOpen
      />,
      { wrapper },
    );

    expect(screen.getByRole("button", { name: /Coverage by country and year/ })).toHaveTextContent(
      "No matching data",
    );
    expect(
      screen.getByText("No matching published PMOs have both a country and a collection year."),
    ).toBeInTheDocument();
  });
});
