import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";

import { buildExamplePmo } from "@/domain/build/testing";
import { catalogue } from "@/features/published/testing";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { createTestStore, renderWithStore } from "@/features/shared/testing";

import { OpenPublished, type FileFetcher } from "./OpenPublished";
import { PmoFilePage, PMO_TABS, type PmoTab } from "./PmoFilePage";
import { workingPmoSessionOf } from "@/state";

import { resetWorkspace } from "./workspace";

const ZENODO: ZenodoConfig = {
  community: "plasmogenepi",
  communityName: "PlasmoGenEpi",
  clientId: "client-1",
};

const READY = () => Promise.resolve({ kind: "ready" as const, index: catalogue() });

/** The example PMO with its own sample names, so it does not count as the example. */
function ownPmo(): PortableMicrohaplotypeObject {
  const pmo = buildExamplePmo();
  return {
    ...pmo,
    library_sample_info: pmo.library_sample_info.map((sample, index) =>
      Object.assign({}, sample, { library_sample_name: `lab_sample_${index + 1}` }),
    ),
  };
}

const FILE = new Blob([stringifyPmo(ownPmo())]);

function isTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

async function openRecord(id: string, fetcher: FileFetcher, store = createTestStore()) {
  const user = userEvent.setup();
  const rendered = await renderWithStore(
    <Switch>
      <Route path="/pmo/published/:id">
        {(params: { id: string }) => (
          <OpenPublished id={params.id} load={READY} fetcher={fetcher} />
        )}
      </Route>
      <Route path="/pmo/:tab">
        {(params: { tab?: string }) => (
          <PmoFilePage zenodo={ZENODO} tab={isTab(params.tab) ? params.tab : "overview"} />
        )}
      </Route>
    </Switch>,
    { store, path: `/pmo/published/${id}` },
  );
  return { user, ...rendered };
}

beforeEach(() => {
  resetWorkspace();
});

describe("OpenPublished", () => {
  it("downloads the record's file from Zenodo and opens it on the overview", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const { user } = await openRecord("303", fetcher);
    expect(await screen.findByText("This is a published PMO")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content",
    );
    expect(
      screen.getByRole("link", { name: /Border travellers, Mozambique and Eswatini/ }),
    ).toHaveAttribute("href", "https://zenodo.org/records/303");
    expect(screen.getByText("study.pmo.json.gz")).toBeInTheDocument();

    // It is published already: the whole file is not offered for deposit again.
    await user.click(screen.getByRole("tab", { name: "Publish to Zenodo" }));
    expect(await screen.findByText("This file is already published")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Deposit in/ })).not.toBeInTheDocument();
  });

  it("does not download a record that is already open", async () => {
    const fetcher = vi.fn<FileFetcher>().mockResolvedValue(FILE);
    const first = await openRecord("303", fetcher);
    await screen.findByText("This is a published PMO");
    first.unmount();
    const second = await openRecord("303", fetcher, first.store);
    expect(await screen.findByText("This is a published PMO")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(workingPmoSessionOf(second.store).state.getState().open).toMatchObject({
      origin: { kind: "published", id: "303" },
    });
  });

  it("offers to try again, or to download by hand, when Zenodo cannot be reached", async () => {
    const fetcher = vi
      .fn<FileFetcher>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(FILE);
    const { user } = await openRecord("303", fetcher);
    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText("The file could not be downloaded from Zenodo"),
    ).toBeInTheDocument();
    expect(
      within(alert).getByRole("link", { name: "Download it from Zenodo instead" }),
    ).toHaveAttribute("href", "https://zenodo.org/api/records/303/files/study.pmo.json.gz/content");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("This is a published PMO")).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("says so when the record is not in the list", async () => {
    const fetcher = vi.fn<FileFetcher>();
    await openRecord("999", fetcher);
    expect(await screen.findByText("This published PMO is not in the list")).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
