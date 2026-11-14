import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryLocation } from "wouter/memory-location";
import { beforeAll, describe, expect, it } from "vitest";

import { createTestStore, exampleFile } from "@/features/shared/testing";
import type { AppStore } from "@/state";
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
    await waitFor(() => expect(location.history.at(-1)).toBe("/microhaplotypes"), {
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
    expect(
      await screen.findByRole("button", { name: /Continue where you left off/ }),
    ).toBeInTheDocument();
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
    const { location, user } = await renderApp(store, "/microhaplotypes");
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(await screen.findByRole("menuitem", { name: "Start over" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Start over?" });
    await user.click(within(dialog).getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(location.history.at(-1)).toBe("/"));
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
    expect(await screen.findByText("Your draft was removed")).toBeInTheDocument();
  });
});
