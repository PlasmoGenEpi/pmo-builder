import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogueLoad } from "./catalogue";
import { catalogue } from "./testing";
import {
  loadSharedCatalogue,
  resetSharedCatalogueForTests,
  useCatalogue,
  type CatalogueLoader,
  type CatalogueState,
} from "./useCatalogue";

afterEach(() => {
  resetSharedCatalogueForTests();
  vi.restoreAllMocks();
});

const missingLoader: CatalogueLoader = () => Promise.resolve<CatalogueLoad>({ kind: "missing" });

function Probe({
  load = loadSharedCatalogue,
  seen,
}: {
  readonly load?: CatalogueLoader;
  readonly seen?: CatalogueState["kind"][];
}) {
  const state = useCatalogue(load);
  seen?.push(state.kind);
  return <output>{state.kind}</output>;
}

describe("useCatalogue", () => {
  it("initializes synchronously from the shared cache on remount without flashing loading", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const firstRenderKinds: CatalogueState["kind"][] = [];
    const { unmount } = render(<Probe seen={firstRenderKinds} />);
    expect(firstRenderKinds[0]).toBe("loading");
    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    unmount();

    // Remounting reads the resolved shared cache on its very first render.
    const remountKinds: CatalogueState["kind"][] = [];
    render(<Probe seen={remountKinds} />);
    expect(remountKinds).toEqual(["ready"]);
    expect(screen.getByText("ready")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("retries after a failed shared load instead of caching the failure", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(catalogue()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const { unmount } = render(<Probe />);
    expect(await screen.findByText("failed")).toBeInTheDocument();
    unmount();

    const retryKinds: CatalogueState["kind"][] = [];
    render(<Probe seen={retryKinds} />);
    expect(retryKinds[0]).toBe("loading");
    expect(await screen.findByText("ready")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("keeps custom loaders isolated from the shared cache", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await loadSharedCatalogue();

    const customKinds: CatalogueState["kind"][] = [];
    render(<Probe load={missingLoader} seen={customKinds} />);
    expect(customKinds[0]).toBe("loading");
    expect(await screen.findByText("missing")).toBeInTheDocument();
  });
});
