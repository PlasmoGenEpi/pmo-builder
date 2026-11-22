import { I18nProvider } from "@lingui/react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeAll, describe, expect, it } from "vitest";

import type { ZenodoConfig } from "@/features/review/zenodo";
import { i18n } from "@/i18n";
import { installDomPolyfills } from "@/ui/testPolyfills";

import type { CatalogueLoad } from "./catalogue";
import { DatasetPage } from "./DatasetPage";
import { PublishedPage } from "./PublishedPage";
import { catalogue, DATASETS } from "./testing";

beforeAll(installDomPolyfills);

/** `<Trans>` needs the i18n context, as in the app. */
function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

const ZENODO: ZenodoConfig = {
  community: "pmocommunity",
  communityName: "PMO",
  clientId: null,
};

const gives = (load: CatalogueLoad) => () => Promise.resolve(load);
const READY = gives({ kind: "ready", index: catalogue() });

function titles(): string[] {
  return screen
    .getAllByRole("article")
    .map((card) => within(card).getByRole("heading").textContent);
}

async function choose(user: ReturnType<typeof userEvent.setup>, field: string, option: string) {
  await user.click(screen.getByRole("combobox", { name: field }));
  await user.click(await screen.findByRole("option", { name: option }));
}

describe("PublishedPage", () => {
  it("lists the datasets with totals, each linking to its page", async () => {
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    expect(await screen.findByText("3 datasets")).toBeInTheDocument();
    expect(titles()).toEqual([
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);
    expect(screen.getByText("1,258")).toBeInTheDocument();
    const [first] = screen.getAllByRole("article");
    if (first === undefined) throw new Error("no dataset");
    expect(within(first).getByText("50 specimens")).toBeInTheDocument();
    expect(within(first).getByText("276 targets")).toBeInTheDocument();
    expect(within(first).getByText("Mad4hatter")).toBeInTheDocument();
    expect(within(first).getByText("Mozambique")).toBeInTheDocument();
    expect(within(first).getByText("2015 to 2019")).toBeInTheDocument();
    expect(screen.getByText("Achan, Sarah · 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Northern Uganda cohort" })).toHaveAttribute(
      "href",
      "/published/302",
    );
    expect(screen.getByRole("link", { name: /PMO community/ })).toHaveAttribute(
      "href",
      "https://zenodo.org/communities/pmocommunity/",
    );
    expect(screen.getByText(/Read from Zenodo on 15 November 2026/)).toBeInTheDocument();
  });

  it("narrows the list by search, country, panel and year", async () => {
    const user = userEvent.setup();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 datasets");

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "uganda");
    expect(titles()).toEqual(["Northern Uganda cohort"]);
    expect(screen.getByText("1 of 3 datasets")).toBeInTheDocument();
    await user.clear(screen.getByRole("searchbox", { name: "Search" }));

    await choose(user, "Country", "Mozambique");
    expect(titles()).toEqual([
      "Maputo surveillance 2015 to 2019",
      "Border travellers, Mozambique and Eswatini",
    ]);
    await choose(user, "Panel", "AMPLseq");
    expect(titles()).toEqual(["Border travellers, Mozambique and Eswatini"]);
    await choose(user, "Country", "Any country");
    await choose(user, "Panel", "Any panel");
    await choose(user, "Collected in", "2017");
    expect(titles()).toEqual(["Maputo surveillance 2015 to 2019"]);
  });

  it("offers to clear the filters when nothing matches", async () => {
    const user = userEvent.setup();
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper });
    await screen.findByText("3 datasets");
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "nothing like this");
    expect(screen.getByText("No published PMO matches")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(titles()).toHaveLength(3);
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  });

  it("leaves the filters out when there is only one dataset", async () => {
    render(
      <PublishedPage
        load={gives({ kind: "ready", index: catalogue(DATASETS.slice(0, 1)) })}
        zenodo={ZENODO}
      />,
      { wrapper },
    );
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/");
  });

  it("invites a first deposit when nothing has been published", async () => {
    render(
      <PublishedPage load={gives({ kind: "ready", index: catalogue([]) })} zenodo={ZENODO} />,
      { wrapper },
    );
    expect(await screen.findByText("No PMO has been published yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("says so when the list is missing or cannot be loaded", async () => {
    const { unmount } = render(<PublishedPage load={gives({ kind: "missing" })} zenodo={null} />, {
      wrapper,
    });
    expect(
      await screen.findByText("This copy of PMO Builder has no list of published PMOs"),
    ).toBeInTheDocument();
    unmount();
    render(<PublishedPage load={gives({ kind: "failed" })} zenodo={ZENODO} />, { wrapper });
    expect(
      await screen.findByText("The list of published PMOs could not be loaded"),
    ).toBeInTheDocument();
  });
});

describe("DatasetPage", () => {
  it("shows what the PMO holds, where to get it and how to cite it", async () => {
    const user = userEvent.setup();
    render(<DatasetPage id="303" load={READY} />, { wrapper });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Border travellers, Mozambique and Eswatini",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Okello, Grace; Mensah, Kofi")).toBeInTheDocument();
    expect(screen.getByText("Published 14 November 2026")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "See its summary" })).toHaveAttribute(
      "href",
      "/pmo/published/303/summary",
    );
    const download = screen.getByRole("link", { name: /download from zenodo/i });
    expect(download).toHaveAttribute(
      "href",
      "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content",
    );
    expect(download).toHaveAttribute("rel", "noreferrer noopener");
    expect(screen.getByText("study.pmo.json.gz, 22 KB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see the record on zenodo/i })).toHaveAttribute(
      "href",
      "https://zenodo.org/records/303",
    );

    const details = screen.getByRole("region", { name: "About the data" });
    expect(within(details).getByText("Mad4hatter, AMPLseq")).toBeInTheDocument();
    expect(within(details).getByText("Eswatini, Mozambique")).toBeInTheDocument();
    expect(
      within(details).getByText("Plasmodium falciparum, Plasmodium vivax"),
    ).toBeInTheDocument();
    expect(within(details).queryByText("Collected")).not.toBeInTheDocument();
    expect(within(details).getByRole("link", { name: /10\.5281\/zenodo\.303/ })).toHaveAttribute(
      "href",
      "https://doi.org/10.5281/zenodo.303",
    );
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy citation" }));
    expect(await navigator.clipboard.readText()).toBe(
      "Okello, Grace; Mensah, Kofi (2026). Border travellers, Mozambique and Eswatini. Zenodo. https://doi.org/10.5281/zenodo.303",
    );
    expect(screen.getByRole("link", { name: "All published PMOs" })).toHaveAttribute(
      "href",
      "/published",
    );
  });

  it("says so when the PMO is not in the list", async () => {
    render(<DatasetPage id="999" load={READY} />, { wrapper });
    expect(await screen.findByText("This PMO is not in the list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All published PMOs" })).toBeInTheDocument();
  });
});
