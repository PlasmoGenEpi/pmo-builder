import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";
import { catalogue, dataset } from "@/features/published/testing";
import { resetSharedCatalogueForTests } from "@/features/published/useCatalogue";
import { createTestStore } from "@/features/shared/testing";
import { workingPmoSessionOf, type EditorLock } from "@/state";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { App } from "./App";
import { pageIdentity } from "./pageIdentity";
import { STEPS, getStep, page } from "./steps";

beforeAll(installDomPolyfills);
afterEach(() => {
  resetSharedCatalogueForTests();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function LoadedPage() {
  return <p>Loaded page</p>;
}

function renderAt(path: string) {
  const location = memoryLocation({ path, record: true });
  render(<App locationHook={location.hook} store={createTestStore()} />);
  return { location, user: userEvent.setup() };
}

describe("App", () => {
  it("renders the home page with a main landmark", () => {
    renderAt("/");
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "PMO Builder" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open a PMO file" })).toHaveAttribute("href", "/pmo");
    const sections = screen.getByRole("navigation", { name: "Sections" });
    expect(within(sections).getByRole("link", { name: "Build" })).toHaveAttribute("href", "/build");
    expect(within(sections).getByRole("link", { name: "My PMO file" })).toHaveAttribute(
      "href",
      "/pmo",
    );
    // The step list belongs to the Build section only.
    expect(screen.queryByRole("navigation", { name: "Steps" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download the Excel template" })).toHaveAttribute(
      "href",
      "/examples/PMO_building_template.xlsx",
    );
  });

  it("moves between two steps from the sidebar", async () => {
    const { location, user } = renderAt("/build/microhaplotypes");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Microhaplotypes" }),
    ).toBeInTheDocument();

    const sidebar = screen.getByRole("navigation", { name: "Steps" });
    const current = within(sidebar).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Microhaplotypes");
    // Status is given in words; progress on the required steps heads the list.
    expect(current).toHaveTextContent("Not started");
    expect(sidebar).toHaveTextContent("0 of 2 required steps ready");
    const sections = screen.getByRole("navigation", { name: "Sections" });
    expect(within(sections).getByRole("link", { current: "page" })).toHaveTextContent("Build");

    await user.click(within(sidebar).getByRole("link", { name: /Panel/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Panel" })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/build/panel");
    expect(within(sidebar).getByRole("link", { current: "page" })).toHaveTextContent("Panel");
  });

  it("links Back and Next in registry order", async () => {
    const { user } = renderAt("/build/panel");
    await screen.findByRole("heading", { level: 1, name: "Panel" });
    const pager = screen.getByRole("navigation", { name: "Previous and next step" });
    expect(within(pager).getByRole("link", { name: /Back\s*Microhaplotypes/ })).toBeInTheDocument();
    await user.click(within(pager).getByRole("link", { name: /Next\s*Specimens/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Specimens" })).toBeInTheDocument();
  });

  it("asks before starting over", async () => {
    const { user } = renderAt("/");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Start over" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start over?" });
    expect(dialog).toHaveTextContent(
      "This removes from this browser your tables, your column choices, everything you typed in, and any earlier draft that could not be opened. Saved panels are kept: delete them on the Panel step. This cannot be undone.",
    );
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("loads the next step's code when the browser is idle", async () => {
    const preload = vi.spyOn(getStep("specimens"), "preload");
    renderAt("/build/panel");
    await screen.findByRole("heading", { level: 1, name: "Panel" });
    await waitFor(() => expect(preload).toHaveBeenCalled());
  });

  it("loads the first step's code from the home page", async () => {
    const preload = vi.spyOn(getStep("microhaplotypes"), "preload");
    renderAt("/");
    await waitFor(() => expect(preload).toHaveBeenCalled());
  });

  it("renders a preloaded page without suspending", async () => {
    const module = page(() => Promise.resolve(LoadedPage));
    await module.preload();
    const Page = module.component;
    render(<Page />);
    // No Suspense boundary: a page that suspended here would throw.
    expect(screen.getByText("Loaded page")).toBeInTheDocument();
  });

  it("retries a page whose code failed to load", async () => {
    let attempts = 0;
    const module = page(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(LoadedPage);
    });
    await module.preload();
    await module.preload();
    expect(attempts).toBe(2);
  });

  it("shows a page for an unknown address", async () => {
    renderAt("/nowhere");
    expect(await screen.findByText("This page does not exist")).toBeInTheDocument();
  });
});

describe("usage counts for pages outside the steps", () => {
  it("counts the published list, a dataset page, a published view and My PMO file by kind only", async () => {
    const spy = vi.spyOn(await import("@/analytics"), "recordPageOpened");
    for (const path of [
      "/published",
      "/published/24237928",
      "/published/24237928/summary",
      "/pmo",
    ]) {
      const { unmount } = render(
        <App locationHook={memoryLocation({ path }).hook} store={createTestStore()} />,
      );
      unmount();
    }
    expect(spy.mock.calls).toEqual([["published"], ["dataset"], ["dataset"], ["pmo-file"]]);
  });

  it("does not count legacy /pmo/published links as My PMO file", async () => {
    const spy = vi.spyOn(await import("@/analytics"), "recordPageOpened");
    const { location } = renderAt("/pmo/published/303/summary");
    await waitFor(() => expect(location.history.at(-1)).toBe("/published/303/summary"));
    expect(spy).not.toHaveBeenCalledWith("pmo-file");
    expect(spy).toHaveBeenCalledWith("dataset");
  });
});

describe("addresses from before the sections", () => {
  it.each([
    ["/panel", "/build/panel"],
    ["/review", "/build/review"],
    ["/publish", "/pmo/publish"],
    ["/pmo-tools", "/pmo"],
    ["/build", "/build/microhaplotypes"],
    ["/pmo/published/303", "/published/303/overview"],
    ["/pmo/published/303/summary", "/published/303/summary"],
    ["/pmo/published/303/subset", "/published/303/overview"],
  ])("sends %s to %s", async (from, to) => {
    const { location } = renderAt(from);
    await waitFor(() => expect(location.history.at(-1)).toBe(to));
  });
});

describe("published view in the app shell", () => {
  it("marks Published active in the top bar on /published/:id/:tab", async () => {
    vi.stubEnv("VITE_ZENODO_COMMUNITY", "pmocommunity");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderAt("/published/303/summary");
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Border travellers, Mozambique and Eswatini",
      }),
    ).toBeInTheDocument();
    const sections = screen.getByRole("navigation", { name: "Sections" });
    expect(within(sections).getByRole("link", { current: "page" })).toHaveTextContent("Published");
    expect(within(sections).getByRole("link", { name: "My PMO file" })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

async function createOtherTabStore() {
  const editorLock: EditorLock = {
    claim: () => Promise.resolve("elsewhere"),
    takeOver: () => Promise.resolve(),
    onStepBack: () => {},
  };
  const store = createTestStore({ editorLock });
  await store.getState().actions.initialise();
  return store;
}

describe("other-tab draft notice", () => {
  it.each(STEPS.map((step) => [step.path, step.title] as const))(
    "shows on Build step %s",
    async (path, heading) => {
      const store = await createOtherTabStore();
      render(<App locationHook={memoryLocation({ path }).hook} store={store} />);
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
      expect(screen.getByText("This draft is open in another tab")).toBeInTheDocument();
    },
  );

  it.each([
    ["/", "PMO Builder"],
    ["/pmo", "My PMO file"],
    ["/published", "Published PMOs"],
    ["/published/301", "Maputo surveillance 2015 to 2019"],
    ["/published/301/summary", "Maputo surveillance 2015 to 2019"],
  ])("does not show on %s", async (path, heading) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(catalogue()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const store = await createOtherTabStore();
    render(<App locationHook={memoryLocation({ path }).hook} store={store} />);
    expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.queryByText("This draft is open in another tab")).not.toBeInTheDocument();
  });
});

describe("pageIdentity and tab-switch stability", () => {
  it.each([
    ["/", "/"],
    ["/build/panel", "/build/panel"],
    ["/pmo", "/pmo"],
    ["/pmo/overview", "/pmo"],
    ["/pmo/summary", "/pmo"],
    ["/pmo/open-built", "/pmo/open-built"],
    ["/published", "/published"],
    ["/published/303", "/published/303"],
    ["/published/303/overview", "/published/303"],
    ["/published/303/summary", "/published/303"],
    ["/published/304/summary", "/published/304"],
  ])("maps %s to %s", (from, expected) => {
    expect(pageIdentity(from)).toBe(expected);
  });

  it("keeps Tabs mounted and preserves keyboard focus across /published/:id/:tab switches", async () => {
    vi.stubEnv("VITE_ZENODO_COMMUNITY", "pmocommunity");
    const pmoBytes = new TextEncoder().encode(JSON.stringify(buildExamplePmo()));
    const fileUrl = "https://zenodo.org/api/records/303/files/study.pmo.json/content";
    const index = catalogue([
      dataset({
        id: "303",
        title: "Border travellers, Mozambique and Eswatini",
        file: { name: "study.pmo.json", size: pmoBytes.byteLength, url: fileUrl },
      }),
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === fileUrl) {
        return Promise.resolve(
          new Response(Uint8Array.from(pmoBytes), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(index), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    const { location, user } = renderAt("/published/303/overview");
    const overviewTab = await screen.findByRole("tab", { name: "Overview" });
    const tablist = screen.getByRole("tablist");
    scrollToSpy.mockClear();

    overviewTab.focus();
    expect(overviewTab).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(location.history.at(-1)).toBe("/published/303/summary");
    expect(screen.getByRole("tablist")).toBe(tablist);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveFocus();
    expect(scrollToSpy).not.toHaveBeenCalled();

    await user.keyboard("{ArrowRight}");
    expect(location.history.at(-1)).toBe("/published/303/compare");
    expect(screen.getByRole("tablist")).toBe(tablist);
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveFocus();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });

  it("keeps Tabs mounted and preserves keyboard focus across /pmo/:tab switches", async () => {
    const pmoBytes = new TextEncoder().encode(JSON.stringify(buildExamplePmo()));
    const store = createTestStore();
    await workingPmoSessionOf(store).open({
      kind: "file",
      file: new Blob([pmoBytes], { type: "application/json" }),
      name: "study.pmo.json",
      origin: { kind: "chosen" },
    });
    const scrollToSpy = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const location = memoryLocation({ path: "/pmo/overview", record: true });
    const user = userEvent.setup();
    render(<App locationHook={location.hook} store={store} />);

    const overviewTab = await screen.findByRole("tab", { name: "Overview" });
    const tablist = screen.getByRole("tablist");
    scrollToSpy.mockClear();

    overviewTab.focus();
    expect(overviewTab).toHaveFocus();

    await user.keyboard("{ArrowRight}");
    expect(location.history.at(-1)).toBe("/pmo/summary");
    expect(screen.getByRole("tablist")).toBe(tablist);
    expect(screen.getByRole("tab", { name: "Summary" })).toHaveFocus();
    expect(scrollToSpy).not.toHaveBeenCalled();

    await user.keyboard("{ArrowRight}");
    expect(location.history.at(-1)).toBe("/pmo/compare");
    expect(screen.getByRole("tablist")).toBe(tablist);
    expect(screen.getByRole("tab", { name: "Compare" })).toHaveFocus();
    expect(scrollToSpy).not.toHaveBeenCalled();
  });
});
