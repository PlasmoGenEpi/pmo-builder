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
import { signIn } from "@/features/review/zenodoAuth";
import { depositDraft } from "@/features/review/zenodoDeposit";
import { createTestStore } from "@/features/shared/testing";
import { i18n } from "@/i18n";
import { AppStoreProvider, workingPmoSessionOf } from "@/state";
import { installBlobStream } from "@/test/blobStream";
import { ToastProvider } from "@/ui";
import { installDomPolyfills } from "@/ui/testPolyfills";
import { createInThreadEngine } from "@/worker/engine";

import { OpenPublished, type FileFetcher } from "./OpenPublished";
import { PmoFilePage, PMO_TABS, type PmoTab } from "./PmoFilePage";
import { isPublishedTab } from "./publishedTabs";

vi.mock("@/features/review/zenodoAuth", () => ({ signIn: vi.fn<typeof signIn>() }));
vi.mock("@/features/review/zenodoDeposit", () => ({ depositDraft: vi.fn<typeof depositDraft>() }));

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
    expect(fetcher).toHaveBeenCalledTimes(1);

    // Leave the published view via the Dataset page link.
    await user.click(screen.getByRole("link", { name: "Dataset page" }));
    expect(await screen.findByText("Dataset page 303")).toBeInTheDocument();

    // Working PMO and its 3-specimen subset are still intact in My PMO file.
    act(() => {
      location.navigate("/pmo/overview");
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "my-lab.pmo.json" }),
    ).toBeInTheDocument();
    const sourceSwitch = screen.getByRole("radiogroup", { name: "Work with" });
    expect(within(sourceSwitch).getByRole("radio", { name: "Subset" })).toBeChecked();
    await user.click(screen.getByRole("tab", { name: "Subset" }));
    expect(await screen.findByText(/^It keeps 3 of \d+ specimens/)).toBeInTheDocument();

    // Returning to the published view fetches again, confirming it was dropped on leaving.
    act(() => {
      location.navigate("/published/303/overview");
    });
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("drops the previous published PMO when navigating directly to another published record", async () => {
    const fetcher = vi
      .fn<FileFetcher>()
      .mockResolvedValueOnce(FILE)
      .mockResolvedValueOnce(OTHER_FILE)
      .mockResolvedValueOnce(FILE);
    const { location } = await openPublishedView("/published/303/overview", { fetcher });

    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toHaveTextContent("8");

    act(() => {
      location.navigate("/published/301/overview");
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Maputo surveillance 2015 to 2019" }),
    ).toBeInTheDocument();
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "What is in the PMO" })).toHaveTextContent("4");
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // Navigating back to 303 downloads it again, confirming 303 was dropped when 301 opened.
    act(() => {
      location.navigate("/published/303/overview");
    });
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Border travellers, Mozambique and Eswatini",
      }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "What is in the PMO" })).toHaveTextContent("8");
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
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
        fingerprint: null,
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

  it("explains published wrong-version refusals without telling readers to rebuild from tables", async () => {
    const wrongVersion = {
      ...publishedPmo(4),
      pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" },
    };
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(new Blob([stringifyPmo(wrongVersion)]));

    await openPublishedView("/published/303/summary", { fetcher });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The published file could not be opened")).toBeInTheDocument();
    expect(
      within(alert).getByText(
        "This file is in PMO version 1.0.0. Only version 1.1.0 files can be opened here. Download it from Zenodo to inspect it on your computer.",
      ),
    ).toBeInTheDocument();
    expect(within(alert).queryByText(/Build it again/)).not.toBeInTheDocument();
    expect(within(alert).queryByRole("link", { name: "See why" })).not.toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Download it from Zenodo instead" }),
    ).toHaveAttribute("href", "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content");
  });

  it("explains published missing-version refusals without telling readers to rebuild from tables", async () => {
    const { pmo_version: _omitted, ...headerWithoutVersion } = EXAMPLE.pmo_header;
    const missingVersion = {
      ...publishedPmo(4),
      pmo_header: headerWithoutVersion,
    };
    const fetcher = vi
      .fn<FileFetcher>()
      .mockResolvedValue(new Blob([JSON.stringify(missingVersion)]));

    await openPublishedView("/published/303/summary", { fetcher });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The published file could not be opened")).toBeInTheDocument();
    expect(
      within(alert).getByText(
        "This file does not say which PMO version it is. Only version 1.1.0 files can be opened here. Download it from Zenodo to inspect it on your computer.",
      ),
    ).toBeInTheDocument();
    expect(within(alert).queryByText(/Build it again/)).not.toBeInTheDocument();
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

  describe("Work with this file", () => {
    it("opens the published PMO in My PMO file with all tabs when no working PMO is open, without re-downloading", async () => {
      const deferred = deferredBlob();
      const fetcher = vi
        .fn<FileFetcher>()
        .mockImplementationOnce(() => deferred.promise)
        .mockResolvedValue(FILE);
      const { user, location } = await openPublishedView("/published/303/summary", {
        fetcher,
      });

      // Not offered while still downloading.
      expect(
        await screen.findByText("Downloading study.pmo.json.gz (22 KB) from Zenodo"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Work with this file" })).not.toBeInTheDocument();

      deferred.resolve(FILE);
      expect(
        await screen.findByRole("tab", { name: "Summary", selected: true }),
      ).toBeInTheDocument();

      const header = screen.getByRole("heading", { level: 1 }).closest("header");
      expect(header).not.toBeNull();
      if (header === null) return;
      await user.click(within(header).getByRole("button", { name: "Work with this file" }));

      // Lands on the same tab in My PMO file with all 6 tabs and no confirmation dialog.
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      expect(
        await screen.findByRole("heading", { level: 1, name: "study.pmo.json.gz" }),
      ).toBeInTheDocument();
      expect(location.history.at(-1)).toBe("/pmo/summary");
      expect(screen.getByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
      expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
        "Overview",
        "Summary",
        "Compare",
        "Tables",
        "Subset",
        "Publish to Zenodo",
      ]);

      // Already-downloaded Blob was reused; Zenodo was not contacted again.
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Overview shows the published-PMO origin callout linking back to the Zenodo record.
      await user.click(screen.getByRole("tab", { name: "Overview" }));
      expect(await screen.findByText("This is a published PMO")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: /Border travellers, Mozambique and Eswatini/ }),
      ).toHaveAttribute("href", "https://zenodo.org/records/303");

      // Returning to the published view downloads again, confirming the published slot was freed.
      act(() => {
        location.navigate("/published/303/overview");
      });
      expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("asks before replacing an open working PMO, leaves it intact on cancel, and replaces it on confirm", async () => {
      const store = createTestStore();
      const working = workingPmoSessionOf(store);
      await working.open({
        kind: "file",
        file: new File([stringifyPmo(EXAMPLE)], "my-lab.pmo.json"),
        name: "my-lab.pmo.json",
        origin: { kind: "chosen" },
      });

      const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
      const { user, location } = await openPublishedView("/published/303/tables", {
        store,
        fetcher,
      });

      expect(
        await screen.findByRole("tab", { name: "Tables", selected: true }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/my-lab\.pmo\.json/)).toBeInTheDocument();

      // Cancelling leaves the published view open without re-fetching and keeps the working PMO.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      expect(location.history.at(-1)).toBe("/published/303/tables");
      expect(
        screen.getByRole("button", { name: "Download all tables (.zip)" }),
      ).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Confirming replaces the working PMO without re-downloading and lands on the same tab.
      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      const secondDialog = await screen.findByRole("alertdialog");
      expect(within(secondDialog).getByText(/my-lab\.pmo\.json/)).toBeInTheDocument();
      await user.click(within(secondDialog).getByRole("button", { name: "Replace it" }));

      expect(
        await screen.findByRole("heading", { level: 1, name: "study.pmo.json.gz" }),
      ).toBeInTheDocument();
      expect(location.history.at(-1)).toBe("/pmo/tables");
      expect(screen.getByRole("tab", { name: "Tables", selected: true })).toBeInTheDocument();
      expect(fetcher).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole("tab", { name: "Overview" }));
      expect(await screen.findByText("This is a published PMO")).toBeInTheDocument();
    });

    it("names both the working PMO and its subset in the confirmation, keeping both on cancel and replacing them on confirm", async () => {
      const store = createTestStore();
      const working = workingPmoSessionOf(store);
      await working.open({
        kind: "file",
        file: new File([stringifyPmo(EXAMPLE)], "my-lab.pmo.json"),
        name: "my-lab.pmo.json",
        origin: { kind: "chosen" },
      });
      const subsetNames = EXAMPLE.specimen_info
        .slice(0, 3)
        .map((specimen) => specimen.specimen_name);
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

      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/my-lab\.pmo\.json/)).toBeInTheDocument();
      expect(within(dialog).getByText(/my-lab-subset\.json\.gz/)).toBeInTheDocument();

      // Cancelling leaves both the working PMO and its subset untouched in My PMO file.
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });
      act(() => {
        location.navigate("/pmo/overview");
      });
      expect(
        await screen.findByRole("heading", { level: 1, name: "my-lab.pmo.json" }),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("radiogroup", { name: "Work with" })).getByRole("radio", {
          name: "Subset",
        }),
      ).toBeChecked();

      // Returning and confirming replaces both without re-downloading during hand-off.
      act(() => {
        location.navigate("/published/303/overview");
      });
      expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
      const fetchesBeforeConfirm = fetcher.mock.calls.length;

      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      const confirmDialog = await screen.findByRole("alertdialog");
      await user.click(within(confirmDialog).getByRole("button", { name: "Replace it" }));

      expect(
        await screen.findByRole("heading", { level: 1, name: "study.pmo.json.gz" }),
      ).toBeInTheDocument();
      expect(location.history.at(-1)).toBe("/pmo/overview");
      expect(fetcher).toHaveBeenCalledTimes(fetchesBeforeConfirm);
      expect(screen.queryByRole("radiogroup", { name: "Work with" })).not.toBeInTheDocument();
    });

    it("asks before replacing a working PMO that is still opening", async () => {
      const engine = createInThreadEngine();
      let releaseOpen: () => void = noop;
      const openGate = new Promise<void>((resolve) => {
        releaseOpen = resolve;
      });
      const store = createTestStore({
        engine: {
          ...engine,
          workingPmo: async (call) => {
            if (call.slot === "working" && call.request.kind === "open") {
              await openGate;
            }
            return engine.workingPmo(call);
          },
        },
      });
      // Start opening a working PMO without waiting for it to finish.
      const pendingOpen = workingPmoSessionOf(store).open({
        kind: "file",
        file: new File([stringifyPmo(EXAMPLE)], "slow-lab.pmo.json"),
        name: "slow-lab.pmo.json",
        origin: { kind: "chosen" },
      });

      const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
      const { user, location } = await openPublishedView("/published/303/summary", {
        store,
        fetcher,
      });

      expect(
        await screen.findByRole("tab", { name: "Summary", selected: true }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      const dialog = await screen.findByRole("alertdialog");
      expect(within(dialog).getByText(/slow-lab\.pmo\.json/)).toBeInTheDocument();

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
      });

      releaseOpen();
      await pendingOpen;
      act(() => {
        location.navigate("/pmo/overview");
      });
      expect(
        await screen.findByRole("heading", { level: 1, name: "slow-lab.pmo.json" }),
      ).toBeInTheDocument();
    });

    it("recovers the published view when hand-off into My PMO file is superseded", async () => {
      const engine = createInThreadEngine();
      let supersedeNext = true;
      let storeRef: ReturnType<typeof createTestStore> | null = null;
      const store = createTestStore({
        engine: {
          ...engine,
          workingPmo: async (call) => {
            if (call.slot === "working" && call.request.kind === "open" && supersedeNext) {
              supersedeNext = false;
              // Simulate a competing open or close superseding this hand-off before it settles.
              if (storeRef !== null) void workingPmoSessionOf(storeRef).close();
            }
            return engine.workingPmo(call);
          },
        },
      });
      storeRef = store;

      const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
      const { user, location } = await openPublishedView("/published/303/summary", {
        store,
        fetcher,
      });

      expect(
        await screen.findByRole("tab", { name: "Summary", selected: true }),
      ).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Work with this file" }));

      // Stays in the published view and recovers cleanly instead of hanging on "Downloading".
      expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Summary", selected: true })).toBeInTheDocument();
      expect(screen.queryByText(/Downloading/)).not.toBeInTheDocument();
      expect(screen.queryByText("Opening in My PMO file")).not.toBeInTheDocument();
      expect(location.history.at(-1)).toBe("/published/303/summary");
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("preserves published origin on Publish and lets the owner deposit a new version from a subset", async () => {
      installBlobStream();
      vi.mocked(signIn).mockReset();
      vi.mocked(depositDraft).mockReset();
      vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
      vi.mocked(depositDraft).mockResolvedValue({
        ok: true,
        draftUrl: "https://zenodo.org/uploads/30301",
      });

      const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
      const { user } = await openPublishedView("/published/303/overview", { fetcher });
      expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Work with this file" }));
      expect(
        await screen.findByRole("heading", { level: 1, name: "study.pmo.json.gz" }),
      ).toBeInTheDocument();

      // Unmodified original is still blocked from accidental re-deposit.
      await user.click(screen.getByRole("tab", { name: "Publish to Zenodo" }));
      expect(await screen.findByText("This file is already published")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Deposit in the PMO community" }),
      ).not.toBeInTheDocument();

      // After making a subset, depositing a new version of the owned Zenodo record works.
      await user.click(screen.getByRole("tab", { name: "Subset" }));
      const minReadsInput = await screen.findByLabelText(/Minimum reads per microhaplotype/);
      await user.clear(minReadsInput);
      await user.type(minReadsInput, "100");
      const makeButton = screen.getByRole("button", { name: "Make the subset" });
      await waitFor(() => expect(makeButton).toBeEnabled());
      await user.click(makeButton);
      expect(await screen.findByText("The subset is ready")).toBeInTheDocument();

      await user.click(screen.getByRole("tab", { name: "Publish to Zenodo" }));
      const openDeposit = await screen.findByRole("button", {
        name: "Deposit in the PMO community",
      });
      await user.click(openDeposit);

      const dialog = await screen.findByRole("dialog", { name: "Publish to Zenodo" });
      await user.click(
        within(dialog).getByRole("radio", { name: /A new version of a record I published/ }),
      );
      await user.type(
        within(dialog).getByRole("textbox", { name: "The record" }),
        "https://zenodo.org/records/303",
      );
      await user.click(
        within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" }),
      );

      expect(depositDraft).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          newVersionOf: "303",
          creators: [],
        }),
      );
      expect(
        await within(dialog).findByText("Your new version is ready on Zenodo"),
      ).toBeInTheDocument();
    });
  });
});
