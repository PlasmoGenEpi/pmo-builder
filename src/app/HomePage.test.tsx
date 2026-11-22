import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryLocation } from "wouter/memory-location";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestStore, exampleFile } from "@/features/shared/testing";
import type { AppStore } from "@/state";
import { installBlobStream } from "@/test/blobStream";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { App } from "./App";

beforeAll(installDomPolyfills);

/** A promise that settles when `release` is called. */
function makeGate(): { gate: Promise<void>; release: () => void } {
  const resolvers: Array<() => void> = [];
  const gate = new Promise<void>((resolve) => {
    resolvers.push(resolve);
  });
  return { gate, release: () => resolvers.forEach((resolve) => resolve()) };
}

async function renderApp(store: AppStore = createTestStore(), path = "/") {
  const location = memoryLocation({ path, record: true });
  render(<App locationHook={location.hook} store={store} />);
  await act(() => store.getState().actions.initialise());
  return { store, location, user: userEvent.setup() };
}

describe("home page actions", () => {
  it("loads the example data with progress, then opens the first step", async () => {
    const { gate, release } = makeGate();
    const store = createTestStore({
      fetchExample: async (path) => {
        await gate;
        return exampleFile(path.replace("examples/", ""));
      },
    });
    const { location, user } = await renderApp(store);
    await user.click(screen.getByRole("button", { name: "Try with example data" }));
    expect(await screen.findByText("Loading the example tables")).toBeInTheDocument();
    release();
    await waitFor(() => expect(location.history.at(-1)).toBe("/build/microhaplotypes"), {
      timeout: 10_000,
    });
    expect(store.getState().draft.microhaplotypes.table?.table.fileName).toBe(
      "mad4hatter_allele_data_example.csv",
    );
    expect(
      await screen.findByRole("heading", { level: 1, name: "Microhaplotypes" }),
    ).toBeInTheDocument();
  });

  it("says plainly when the example cannot be loaded", async () => {
    const store = createTestStore({
      fetchExample: () => Promise.reject(new Error("examples/x.csv could not be fetched (404).")),
    });
    const { location, user } = await renderApp(store);
    await user.click(screen.getByRole("button", { name: "Try with example data" }));
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("The example data could not be loaded")).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/");
  });

  it("offers to continue a draft, and asks before the example replaces it", async () => {
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const { user } = await renderApp(store);
    expect(await screen.findByRole("button", { name: "Continue your draft" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try with example data" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Replace your draft with the example?",
    });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("starts over after confirming, and returns home", async () => {
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    const { location, user } = await renderApp(store, "/build/microhaplotypes");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Start over" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start over?" });
    await user.click(within(dialog).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
    expect(await screen.findByText("Your draft was removed")).toBeInTheDocument();
  });

  it("offers Start over and progress only when there is a draft", async () => {
    await renderApp(createTestStore());
    expect(await screen.findByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
    cleanup();

    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    await renderApp(store);
    await screen.findByRole("button", { name: "Continue your draft" });
    const home = screen.getByRole("main");
    expect(within(home).getByRole("button", { name: "Start over" })).toBeInTheDocument();
    expect(home).toHaveTextContent("of 2 required steps ready");
  });

  it("starts over from the home page after confirming", async () => {
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const { location, user } = await renderApp(store, "/build/panel");
    // The step list no longer has its own Start over; the menu and home page do.
    const steps = screen.getByRole("navigation", { name: "Steps" });
    expect(within(steps).queryByRole("button", { name: "Start over" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /PMO Builder/ }));
    const home = await screen.findByRole("main");
    await user.click(await within(home).findByRole("button", { name: "Start over" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start over?" });
    expect(store.getState().draft.microhaplotypes.table).not.toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
    expect(await screen.findByText("Your draft was removed")).toBeInTheDocument();
    await waitFor(() =>
      expect(within(home).queryByRole("button", { name: "Start over" })).not.toBeInTheDocument(),
    );
  });

  it("starts over from the review step", async () => {
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const { location, user } = await renderApp(store, "/build/review");
    await user.click(await screen.findByRole("button", { name: "Start over for a new PMO" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start over?" });
    await user.click(within(dialog).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
  });
});

describe("opening the built PMO", () => {
  it("lands on the Summary tab from the review step", async () => {
    installBlobStream();
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const { location, user } = await renderApp(store, "/build/review");
    await user.click(await screen.findByRole("link", { name: "Open in My PMO file" }));
    expect(
      await screen.findByRole("tab", { name: "Summary", selected: true }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/pmo/summary");
    expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();
  });

  it("lands on the Summary tab from the home page", async () => {
    installBlobStream();
    const store = createTestStore();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const { location, user } = await renderApp(store, "/");
    await user.click(await screen.findByRole("link", { name: "Open the PMO you are building" }));
    expect(
      await screen.findByRole("tab", { name: "Summary", selected: true }, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/pmo/summary");
    expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();
  });
});
