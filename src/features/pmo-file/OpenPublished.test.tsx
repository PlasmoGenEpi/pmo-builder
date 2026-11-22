import { I18nProvider } from "@lingui/react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  filterPmoBySpecimenNames,
  stringifyPmo,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";
import { Fragment } from "react";
import { describe, expect, it, vi } from "vitest";
import { Redirect, Route, Router, Switch, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";

import { buildExamplePmo } from "@/domain/build/testing";
import { catalogue, dataset } from "@/features/published/testing";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { createTestStore } from "@/features/shared/testing";
import { i18n } from "@/i18n";
import { AppStoreProvider, publishedPmoSessionOf, workingPmoSessionOf } from "@/state";
import { ToastProvider } from "@/ui";
import { installDomPolyfills } from "@/ui/testPolyfills";
import { createInThreadEngine } from "@/worker/engine";

import { isPublishedTab, OpenPublished, type FileFetcher } from "./OpenPublished";
import { PmoFilePage, PMO_TABS, type PmoTab } from "./PmoFilePage";

const ZENODO: ZenodoConfig = {
  community: "pmocommunity",
  communityName: "PMO",
  clientId: "client-1",
};

const EXAMPLE = buildExamplePmo();

/** A small PMO (8 specimens) that tells apart from EXAMPLE (50 specimens). */
function publishedPmo(specimens = 8): PortableMicrohaplotypeObject {
  const smaller = filterPmoBySpecimenNames(
    EXAMPLE,
    EXAMPLE.specimen_info.slice(0, specimens).map((specimen) => specimen.specimen_name),
  );
  return {
    ...smaller,
    library_sample_info: smaller.library_sample_info.map((sample, index) =>
      Object.assign({}, sample, { library_sample_name: `pub_sample_${index + 1}` }),
    ),
  };
}

const FILE = new Blob([stringifyPmo(publishedPmo(8))]);
const OTHER_FILE = new Blob([stringifyPmo(publishedPmo(4))]);

const READY = () => Promise.resolve({ kind: "ready" as const, index: catalogue() });

const noop = (): void => undefined;

function deferredBlob(): {
  readonly promise: Promise<Blob>;
  readonly resolve: (blob: Blob) => void;
} {
  let resolve: (blob: Blob) => void = noop;
  const promise = new Promise<Blob>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function isPmoTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

/**
 * Mirrors `App.tsx`'s `<ErrorBoundary key={location}>`, unmounting and
 * remounting the route component on every location change (including tab
 * switches within `/published/:id/:tab`).
 */
function RouteShell({
  load = READY,
  fetcher,
}: {
  readonly load?: typeof READY;
  readonly fetcher: FileFetcher;
}) {
  const [location] = useLocation();
  return (
    <Fragment key={location}>
      <Switch>
        <Route path="/published">
          <p>Published list</p>
        </Route>
        <Route path="/published/:id">
          {(params: { id: string }) => <p>Dataset page {params.id}</p>}
        </Route>
        <Route path="/published/:id/:tab">
          {(params: { id: string; tab: string }) =>
            isPublishedTab(params.tab) ? (
              <OpenPublished id={params.id} tab={params.tab} load={load} fetcher={fetcher} />
            ) : (
              <Redirect to={`/published/${params.id}/overview`} replace />
            )
          }
        </Route>
        <Route path="/pmo">
          <PmoFilePage zenodo={ZENODO} tab="overview" />
        </Route>
        <Route path="/pmo/:tab">
          {(params: { tab?: string }) => (
            <PmoFilePage zenodo={ZENODO} tab={isPmoTab(params.tab) ? params.tab : "overview"} />
          )}
        </Route>
      </Switch>
    </Fragment>
  );
}

async function openPublishedView(
  path: string,
  options: {
    readonly fetcher?: FileFetcher;
    readonly load?: typeof READY;
    readonly store?: ReturnType<typeof createTestStore>;
  } = {},
) {
  installDomPolyfills();
  const fetcher = options.fetcher ?? vi.fn<FileFetcher>().mockResolvedValue(FILE);
  const store = options.store ?? createTestStore();
  await store.getState().actions.initialise();
  const location = memoryLocation({ path, record: true });
  const user = userEvent.setup();
  const rendered = render(
    <I18nProvider i18n={i18n}>
      <AppStoreProvider store={store}>
        <ToastProvider>
          <Router hook={location.hook}>
            <RouteShell load={options.load ?? READY} fetcher={fetcher} />
          </Router>
        </ToastProvider>
      </AppStoreProvider>
    </I18nProvider>,
  );
  return { user, fetcher, store, location, ...rendered };
}

describe("Published view (OpenPublished)", () => {
  it("keeps the /published/:id/:tab address, shows the record header and only the 4 read-only tabs", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { location } = await openPublishedView("/published/303/summary", { fetcher });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Border travellers, Mozambique and Eswatini",
      }),
    ).toBeInTheDocument();

    // Wait for download + open to finish and Summary to render.
    expect(await screen.findByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();

    // Address kept the record identifier and tab.
    expect(location.history.at(-1)).toBe("/published/303/summary");
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content",
    );

    // Header shows title, authors, link to dataset page and link to Zenodo record.
    const header = screen.getByRole("heading", { level: 1 }).closest("header");
    expect(header).not.toBeNull();
    if (header === null) return;
    expect(within(header).getByText("Okello, Grace; Mensah, Kofi")).toBeInTheDocument();
    expect(within(header).getByRole("link", { name: "Dataset page" })).toHaveAttribute(
      "href",
      "/published/303",
    );
    expect(within(header).getByRole("link", { name: /Zenodo record/ })).toHaveAttribute(
      "href",
      "https://zenodo.org/records/303",
    );

    // Only Overview, Summary, Compare and Tables — no Replace, Remove, Subset or Publish.
    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["Overview", "Summary", "Compare", "Tables"]);
    expect(screen.queryByRole("tab", { name: "Subset" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Publish to Zenodo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Replace/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Work with" })).not.toBeInTheDocument();
  });

  it("lands on the tab named in the address on a fresh visit", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { location } = await openPublishedView("/published/303/tables", { fetcher });

    expect(await screen.findByRole("tab", { name: "Tables", selected: true })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Download all tables (.zip)" }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/tables");
  });

  it("switches tabs without re-downloading and keeps the address in sync", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { user, location } = await openPublishedView("/published/303/summary", { fetcher });

    expect(await screen.findByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
    expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();

    // Set minimum reads on Summary and confirm it survives switching to Compare and back.
    const minReadsInput = screen.getByLabelText("Minimum reads per microhaplotype");
    await user.clear(minReadsInput);
    await user.type(minReadsInput, "50");

    await user.click(screen.getByRole("tab", { name: "Compare" }));
    expect(await screen.findByRole("tab", { name: "Compare", selected: true })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/compare");

    await user.click(screen.getByRole("tab", { name: "Tables" }));
    expect(await screen.findByRole("tab", { name: "Tables", selected: true })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/tables");

    await user.click(screen.getByRole("tab", { name: "Overview" }));
    expect(
      await screen.findByRole("tab", { name: "Overview", selected: true }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/overview");

    await user.click(screen.getByRole("tab", { name: "Summary" }));
    expect(await screen.findByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/summary");

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Minimum reads per microhaplotype")).toHaveValue("50");
  });

  it("leaves a pre-existing working PMO and its subset untouched, and drops the published PMO on leaving", async () => {
    const store = createTestStore();
    const working = workingPmoSessionOf(store);
    const published = publishedPmoSessionOf(store);

    // Open a 50-specimen working PMO and make a 3-specimen subset before visiting a published PMO.
    await working.open({
      kind: "file",
      file: new File([stringifyPmo(EXAMPLE)], "my-lab.pmo.json"),
      name: "my-lab.pmo.json",
      origin: { kind: "chosen" },
    });
    const subsetNames = EXAMPLE.specimen_info.slice(0, 3).map((specimen) => specimen.specimen_name);
    await working.subset({
      specimens: { kind: "names", names: subsetNames },
      targets: { kind: "all" },
      minReads: 0,
    });

    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { user, location } = await openPublishedView("/published/303/overview", {
      store,
      fetcher,
    });

    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    // Overview shows the published PMO's 8 specimens, not the working PMO's 50 or subset's 3.
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toHaveTextContent("8");
    expect(published.state.getState().open).toMatchObject({
      kind: "opened",
      origin: { kind: "published", id: "303" },
    });

    // Leave the published view via the Dataset page link.
    await user.click(screen.getByRole("link", { name: "Dataset page" }));
    expect(await screen.findByText("Dataset page 303")).toBeInTheDocument();

    // Published PMO is dropped from memory on leaving.
    await waitFor(() => {
      expect(published.state.getState().open).toEqual({ kind: "none" });
    });

    // Working PMO and its subset are still intact in My PMO file.
    act(() => {
      location.navigate("/pmo/overview");
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "my-lab.pmo.json" }),
    ).toBeInTheDocument();
    const sourceSwitch = screen.getByRole("radiogroup", { name: "Work with" });
    expect(within(sourceSwitch).getByRole("radio", { name: "Subset" })).toBeChecked();
    expect(working.state.getState().subset).toMatchObject({
      kind: "made",
      made: { summary: { specimens: 3 } },
    });
  });

  it("drops the previous published PMO when navigating directly to another published record", async () => {
    const fetcher = vi
      .fn<FileFetcher>()
      .mockResolvedValueOnce(FILE)
      .mockResolvedValueOnce(OTHER_FILE);
    const { store, location } = await openPublishedView("/published/303/overview", { fetcher });

    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(publishedPmoSessionOf(store).isPublishedOpen("303")).toBe(true);

    act(() => {
      location.navigate("/published/301/overview");
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Maputo surveillance 2015 to 2019" }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(publishedPmoSessionOf(store).isPublishedOpen("301")).toBe(true);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toHaveTextContent("4");
  });

  it("normalizes an unknown tab address to overview", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { location } = await openPublishedView("/published/303/subset", { fetcher });

    expect(
      await screen.findByRole("tab", { name: "Overview", selected: true }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/published/303/overview");
  });

  it("shows the downloading state while fetching from Zenodo", async () => {
    const deferred = deferredBlob();
    const fetcher = vi.fn<FileFetcher>(() => deferred.promise);
    await openPublishedView("/published/303/summary", { fetcher });

    expect(
      await screen.findByText("Downloading study.pmo.json.gz (22 KB) from Zenodo"),
    ).toBeInTheDocument();
    deferred.resolve(FILE);
    expect(await screen.findByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
  });

  it("shows the too-large state with the record header and does not fetch", async () => {
    const huge = dataset({
      id: "404",
      title: "Huge malaria dataset",
      file: {
        name: "huge.pmo.json.gz",
        size: 350 * 1024 * 1024,
        url: "https://zenodo.org/api/records/404/files/huge.pmo.json.gz/content",
      },
    });
    const loadHuge = () => Promise.resolve({ kind: "ready" as const, index: catalogue([huge]) });
    const fetcher = vi.fn<FileFetcher>();

    await openPublishedView("/published/404/summary", { load: loadHuge, fetcher });

    expect(
      await screen.findByRole("heading", { level: 1, name: "Huge malaria dataset" }),
    ).toBeInTheDocument();
    expect(screen.getByText("This file is too large to open in the browser")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download it from Zenodo instead" })).toHaveAttribute(
      "href",
      huge.file.url,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("offers to try again, or to download by hand, when Zenodo cannot be reached", async () => {
    const fetcher = vi
      .fn<FileFetcher>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(FILE);
    const { user } = await openPublishedView("/published/303/overview", { fetcher });
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("The file could not be downloaded from Zenodo"),
    ).toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Download it from Zenodo instead" }),
    ).toHaveAttribute("href", "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("shows why a refused published file could not be opened inline, without linking to /pmo", async () => {
    const wrongVersion = {
      ...publishedPmo(4),
      pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" },
    };
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(new Blob([stringifyPmo(wrongVersion)]));

    await openPublishedView("/published/303/summary", { fetcher });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The published file could not be opened")).toBeInTheDocument();
    expect(within(alert).getByText(/PMO version 1\.0\.0/)).toBeInTheDocument();
    expect(within(alert).queryByRole("link", { name: "See why" })).not.toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Download it from Zenodo instead" }),
    ).toHaveAttribute("href", "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content");
  });

  it("shows invalid schema problems inline for a refused published file, without linking to /pmo", async () => {
    const invalid = {
      ...publishedPmo(4),
      specimen_info: "not-an-array",
    };
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(new Blob([JSON.stringify(invalid)]));

    await openPublishedView("/published/303/summary", { fetcher });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("This file does not match the PMO format")).toBeInTheDocument();
    expect(within(alert).queryByRole("link", { name: "See why" })).not.toBeInTheDocument();
    expect(within(alert).queryByRole("link", { name: "Build a PMO" })).not.toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Download it from Zenodo instead" }),
    ).toHaveAttribute("href", "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content");
  });

  it("says the file could not be opened when opening it fails, not that it was refused", async () => {
    const engine = createInThreadEngine();
    let failing = true;
    const store = createTestStore({
      engine: {
        ...engine,
        workingPmo: (call) =>
          failing && call.request.kind === "open"
            ? Promise.reject(new Error("out of memory"))
            : engine.workingPmo(call),
      },
    });
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { user } = await openPublishedView("/published/303/overview", { fetcher, store });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The published file could not be opened")).toBeInTheDocument();
    expect(within(alert).queryByText(/another PMO version/)).not.toBeInTheDocument();
    expect(screen.queryByText(/out of memory/)).not.toBeInTheDocument();
    failing = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
  });

  it("says so when the record is not in the list", async () => {
    const fetcher = vi.fn<FileFetcher>();
    await openPublishedView("/published/999/summary", { fetcher });
    expect(await screen.findByText("This published PMO is not in the list")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse published PMOs" })).toHaveAttribute(
      "href",
      "/published",
    );
    expect(fetcher).not.toHaveBeenCalled();
  });
});
