import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { i18n } from "@/i18n";

import type { SortOrder } from "./catalogue";
import { PublishedTable } from "./PublishedTable";
import { dataset, DATASETS } from "./testing";

function Wrapper({ children }: { readonly children: ReactNode }) {
  const location = memoryLocation({ path: "/published" });
  return (
    <I18nProvider i18n={i18n}>
      <Router hook={location.hook}>{children}</Router>
    </I18nProvider>
  );
}

describe("PublishedTable", () => {
  it("shows title, first author, country, collection years, panel, species and specimens", async () => {
    const user = userEvent.setup();
    const onOpenDataset = vi.fn<() => void>();
    const longTitle =
      "Longitudinal genomic surveillance of antimalarial drug resistance markers and parasite population connectivity across sentinel clinics in Kenya (2018 to 2024)";
    const baseSummary = dataset({ id: "base" }).summary;
    const rows = [
      dataset({
        id: "401",
        title: longTitle,
        creators: ["Okello, Grace", "Mensah, Kofi", "Achan, Sarah", "Diallo, Amadou"],
        countries: ["Kenya", "Uganda"],
        collectionYears: { first: 2018, last: 2024 },
        panels: ["Mad4hatter", "AMPLseq"],
        taxa: [5833, 5855],
        summary: { ...baseSummary, specimens: 1_250 },
      }),
      dataset({
        id: "402",
        title: "Single author archive",
        creators: ["Achan, Sarah"],
        countries: ["Mozambique"],
        collectionYears: null,
        panels: ["AMPLseq"],
        taxa: [5833],
        summary: { ...baseSummary, specimens: 42 },
      }),
    ];

    render(
      <PublishedTable
        datasets={rows}
        sort="newest"
        onSortChange={vi.fn<(sort: SortOrder) => void>()}
        onOpenDataset={onOpenDataset}
      />,
      { wrapper: Wrapper },
    );

    const scrollRegion = screen.getByRole("region", { name: "Published PMOs table" });
    expect(scrollRegion).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("table", { name: "Published PMOs" })).toBeInTheDocument();

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers).toEqual([
      "Title",
      "First author",
      "Country",
      "Collection years",
      "Panel",
      "Species",
      "Specimens",
    ]);

    const bodyRows = screen.getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(2);

    const firstRow = bodyRows[0];
    if (firstRow === undefined) throw new Error("missing first row");
    const titleLink = within(firstRow).getByRole("link", { name: longTitle });
    expect(titleLink).toHaveAttribute("href", "/published/401");
    expect(titleLink).toHaveAttribute("title", longTitle);
    expect(within(firstRow).getByText("Okello, Grace et al.")).toHaveAttribute(
      "title",
      "Okello, Grace; Mensah, Kofi; Achan, Sarah; Diallo, Amadou",
    );
    expect(within(firstRow).getByText("Kenya, Uganda")).toBeInTheDocument();
    expect(within(firstRow).getByText("2018 to 2024")).toBeInTheDocument();
    expect(within(firstRow).getByText("Mad4hatter, AMPLseq")).toBeInTheDocument();
    expect(
      within(firstRow).getByText("Plasmodium falciparum, Plasmodium vivax"),
    ).toBeInTheDocument();
    expect(within(firstRow).getByText("1,250")).toBeInTheDocument();

    const secondRow = bodyRows[1];
    if (secondRow === undefined) throw new Error("missing second row");
    expect(within(secondRow).getByText("Achan, Sarah")).toBeInTheDocument();
    expect(within(secondRow).getByText("–")).toBeInTheDocument();
    expect(within(secondRow).getByText("42")).toBeInTheDocument();

    await user.click(titleLink);
    expect(onOpenDataset).toHaveBeenCalledOnce();
  });

  it("syncs sortable headers with SortOrder and calls onSortChange when clicked", async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn<(sort: SortOrder) => void>();
    const onOpenDataset = vi.fn<() => void>();
    const { rerender } = render(
      <PublishedTable
        datasets={DATASETS}
        sort="newest"
        onSortChange={onSortChange}
        onOpenDataset={onOpenDataset}
      />,
      { wrapper: Wrapper },
    );

    const titleHeader = screen.getByRole("columnheader", { name: /Title/ });
    const yearsHeader = screen.getByRole("columnheader", { name: /Collection years/ });
    const specimensHeader = screen.getByRole("columnheader", { name: /Specimens/ });

    expect(titleHeader).toHaveAttribute("aria-sort", "none");
    expect(yearsHeader).toHaveAttribute("aria-sort", "none");
    expect(specimensHeader).toHaveAttribute("aria-sort", "none");

    await user.click(within(specimensHeader).getByRole("button"));
    expect(onSortChange).toHaveBeenLastCalledWith("specimens");

    await user.click(within(yearsHeader).getByRole("button"));
    expect(onSortChange).toHaveBeenLastCalledWith("year");

    await user.click(within(titleHeader).getByRole("button"));
    expect(onSortChange).toHaveBeenLastCalledWith("title");

    rerender(
      <PublishedTable
        datasets={DATASETS}
        sort="specimens"
        onSortChange={onSortChange}
        onOpenDataset={onOpenDataset}
      />,
    );
    expect(specimensHeader).toHaveAttribute("aria-sort", "descending");
    expect(titleHeader).toHaveAttribute("aria-sort", "none");
    expect(yearsHeader).toHaveAttribute("aria-sort", "none");

    rerender(
      <PublishedTable
        datasets={DATASETS}
        sort="year"
        onSortChange={onSortChange}
        onOpenDataset={onOpenDataset}
      />,
    );
    expect(yearsHeader).toHaveAttribute("aria-sort", "descending");
    expect(specimensHeader).toHaveAttribute("aria-sort", "none");

    rerender(
      <PublishedTable
        datasets={DATASETS}
        sort="title"
        onSortChange={onSortChange}
        onOpenDataset={onOpenDataset}
      />,
    );
    expect(titleHeader).toHaveAttribute("aria-sort", "ascending");
    expect(yearsHeader).toHaveAttribute("aria-sort", "none");
  });
});
