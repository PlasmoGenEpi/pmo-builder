import { I18nProvider } from "@lingui/react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { App } from "@/app/App";
import { useHashLocation } from "@/app/hashLocation";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { createTestStore } from "@/features/shared/testing";
import { i18n } from "@/i18n";
import { installDomPolyfills } from "@/ui/testPolyfills";

import type { CatalogueLoad } from "./catalogue";
import { DatasetPage } from "./DatasetPage";
import { clearScrollPositionsForTests, PublishedPage } from "./PublishedPage";
import { catalogue, DATASETS, largeCatalogue } from "./testing";

beforeAll(installDomPolyfills);

afterEach(() => {
  clearScrollPositionsForTests();
  vi.restoreAllMocks();
});

/** `<Trans>` and an isolated memory router, as in the app. */
function makeWrapper(path = "/published") {
  const location = memoryLocation({ path, record: true });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <I18nProvider i18n={i18n}>
        <Router hook={location.hook}>{children}</Router>
      </I18nProvider>
    );
  }
  return { wrapper: Wrapper, location };
}

function DefaultWrapper({ children }: { children: ReactNode }) {
  const [location] = useState(() => memoryLocation({ path: "/published", record: true }));
  return (
    <I18nProvider i18n={i18n}>
      <Router hook={location.hook}>{children}</Router>
    </I18nProvider>
  );
}

const wrapper = DefaultWrapper;

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
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/build");
  });

  it("opens the first Build step from the Build a PMO link under the list", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const location = memoryLocation({ path: "/published", record: true });
    const user = userEvent.setup();
    render(<App locationHook={location.hook} store={createTestStore()} />);

    const share = await screen.findByRole("region", { name: "Share your data" });
    await user.click(within(share).getByRole("link", { name: "Build a PMO" }));

    expect(
      await screen.findByRole("heading", { level: 1, name: "Microhaplotypes" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/build/microhaplotypes");
    expect(location.history).not.toContain("/");
  });

  it("invites a first deposit when nothing has been published", async () => {
    render(
      <PublishedPage load={gives({ kind: "ready", index: catalogue([]) })} zenodo={ZENODO} />,
      { wrapper },
    );
    expect(await screen.findByText("No PMO has been published yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/build");
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

  it("keeps search and filters in the address without pushing a history entry per letter, and clears them", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    const { unmount } = render(<PublishedPage load={READY} zenodo={ZENODO} />, {
      wrapper: listWrapper,
    });
    await screen.findByText("3 datasets");
    expect(location.history).toEqual(["/published"]);

    await user.type(screen.getByRole("searchbox", { name: "Search" }), "maputo");
    expect(location.history).toEqual(["/published?q=maputo"]);

    await choose(user, "Country", "Mozambique");
    expect(location.history).toEqual([
      "/published?q=maputo",
      "/published?q=maputo&country=Mozambique",
    ]);
    expect(titles()).toEqual(["Maputo surveillance 2015 to 2019"]);

    // Loading the copied address shows the same filtered list.
    const copiedAddress = location.history.at(-1);
    unmount();
    const { wrapper: copiedWrapper } = makeWrapper(copiedAddress);
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: copiedWrapper });
    expect(await screen.findByText("1 of 3 datasets")).toBeInTheDocument();
    expect(titles()).toEqual(["Maputo surveillance 2015 to 2019"]);
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("maputo");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(titles()).toHaveLength(3);
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("");
  });

  it("clears the address when clicking Clear the filters", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper(
      "/published?q=maputo&country=Mozambique",
    );
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: listWrapper });
    await screen.findByText("1 of 3 datasets");

    await user.click(screen.getByRole("button", { name: "Clear the filters" }));
    expect(location.history.at(-1)).toBe("/published");
    expect(titles()).toHaveLength(3);
  });

  it("restores search, filters and scroll position when going Back from a dataset", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/#/published");
    const scrollDescriptor = Object.getOwnPropertyDescriptor(window, "scrollY");
    let currentScrollY = 0;
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      get: () => currentScrollY,
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (
        typeof first === "object" &&
        first !== null &&
        "top" in first &&
        typeof first.top === "number"
      ) {
        currentScrollY = first.top;
      }
    });

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={READY} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={READY} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("3 datasets");
      await user.type(screen.getByRole("searchbox", { name: "Search" }), "mozambique");
      await choose(user, "Panel", "Mad4hatter");
      expect(window.location.hash).toBe("#/published?q=mozambique&panel=Mad4hatter");

      currentScrollY = 640;
      window.dispatchEvent(new Event("scroll"));

      await user.click(screen.getByRole("link", { name: "Maputo surveillance 2015 to 2019" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "Maputo surveillance 2015 to 2019" }),
      ).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published/301");

      scrollToSpy.mockClear();
      currentScrollY = 0;
      window.history.back();

      expect(await screen.findByText("2 of 3 datasets")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?q=mozambique&panel=Mad4hatter");
      expect(screen.getByRole("searchbox", { name: "Search" })).toHaveValue("mozambique");
      expect(titles()).toEqual([
        "Maputo surveillance 2015 to 2019",
        "Border travellers, Mozambique and Eswatini",
      ]);
      await waitFor(() => {
        expect(scrollToSpy).toHaveBeenCalledWith({ top: 640 });
      });
    } finally {
      window.history.replaceState(null, "", "/");
      if (scrollDescriptor !== undefined) {
        Object.defineProperty(window, "scrollY", scrollDescriptor);
      } else {
        Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
      }
    }
  });

  it("sorts the list with a visibly labelled control, updates the address, and works from the keyboard", async () => {
    const user = userEvent.setup();
    const { wrapper: listWrapper, location } = makeWrapper("/published");
    render(<PublishedPage load={READY} zenodo={ZENODO} />, { wrapper: listWrapper });
    await screen.findByText("3 datasets");

    const sortControl = screen.getByLabelText("Sort by");
    expect(sortControl).toBe(screen.getByRole("combobox", { name: "Sort by" }));
    expect(sortControl).toHaveTextContent("Newest published");

    // Keyboard: focus the sort control, open it, move down to "Most specimens", and select.
    sortControl.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("{ArrowDown}{Enter}");

    expect(sortControl).toHaveTextContent("Most specimens");
    expect(location.history).toEqual(["/published", "/published?sort=specimens"]);
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Maputo surveillance 2015 to 2019",
      "Border travellers, Mozambique and Eswatini",
    ]);
    // Sorting alone does not filter out entries.
    expect(screen.getByText("3 datasets")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clear the filters" })).not.toBeInTheDocument();

    await choose(user, "Sort by", "Latest collection year");
    expect(location.history.at(-1)).toBe("/published?sort=year");
    expect(titles()).toEqual([
      "Northern Uganda cohort",
      "Maputo surveillance 2015 to 2019",
      "Border travellers, Mozambique and Eswatini",
    ]);

    await choose(user, "Sort by", "Title");
    expect(location.history.at(-1)).toBe("/published?sort=title");
    expect(titles()).toEqual([
      "Border travellers, Mozambique and Eswatini",
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
    ]);

    await choose(user, "Sort by", "Newest published");
    expect(location.history.at(-1)).toBe("/published");
    expect(titles()).toEqual([
      "Maputo surveillance 2015 to 2019",
      "Northern Uganda cohort",
      "Border travellers, Mozambique and Eswatini",
    ]);
  });

  it("orders a 150-entry catalogue by each sort choice and restores sort on Back", async () => {
    const user = userEvent.setup();
    const bigIndex = largeCatalogue(150);
    const loadBig = gives({ kind: "ready", index: bigIndex });
    window.history.replaceState(null, "", "/#/published");

    try {
      render(
        <I18nProvider i18n={i18n}>
          <Router hook={useHashLocation}>
            <Switch>
              <Route path="/published">
                <PublishedPage load={loadBig} zenodo={ZENODO} />
              </Route>
              <Route path="/published/:id">
                {(params) => <DatasetPage id={params.id} load={loadBig} />}
              </Route>
            </Switch>
          </Router>
        </I18nProvider>,
      );

      await screen.findByText("150 datasets");
      expect(titles()[0]).toBe(bigIndex.datasets[0]?.title);

      await choose(user, "Sort by", "Most specimens");
      expect(window.location.hash).toBe("#/published?sort=specimens");
      const maxSpecimens = Math.max(...bigIndex.datasets.map((entry) => entry.summary.specimens));
      const mostSpecimensEntry = bigIndex.datasets.find(
        (entry) => entry.summary.specimens === maxSpecimens,
      );
      expect(titles()[0]).toBe(mostSpecimensEntry?.title);

      await choose(user, "Sort by", "Latest collection year");
      expect(window.location.hash).toBe("#/published?sort=year");
      const newest2026Entry = bigIndex.datasets.find(
        (entry) => entry.collectionYears?.last === 2026,
      );
      expect(titles()[0]).toBe(newest2026Entry?.title);

      await choose(user, "Sort by", "Title");
      expect(window.location.hash).toBe("#/published?sort=title");
      const firstTitle = titles()[0] ?? "";
      expect(firstTitle.startsWith("Angola ")).toBe(true);

      // Open the first dataset and press Back: sort order stays in place.
      await user.click(screen.getByRole("link", { name: firstTitle }));
      expect(
        await screen.findByRole("heading", { level: 1, name: firstTitle }),
      ).toBeInTheDocument();
      expect(window.location.hash).toMatch(/^#\/published\/\d+$/);

      window.history.back();
      expect(await screen.findByText("150 datasets")).toBeInTheDocument();
      expect(window.location.hash).toBe("#/published?sort=title");
      expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Title");
      expect(titles()[0]).toBe(firstTitle);
    } finally {
      window.history.replaceState(null, "", "/");
    }
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
