import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { memoryLocation } from "wouter/memory-location";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestStore } from "@/features/shared/testing";
import { installDomPolyfills } from "@/ui/testPolyfills";

import { App } from "./App";
import { getStep, page } from "./steps";

beforeAll(installDomPolyfills);
afterEach(() => {
  vi.restoreAllMocks();
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
    expect(
      screen.getByRole("heading", { level: 1, name: "Turn your lab's tables into a PMO file" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download the Excel template" })).toHaveAttribute(
      "href",
      "/examples/PMO_building_template.xlsx",
    );
  });

  it("moves between two steps from the sidebar", async () => {
    const { location, user } = renderAt("/microhaplotypes");
    expect(
      await screen.findByRole("heading", { level: 1, name: "Microhaplotypes" }),
    ).toBeInTheDocument();

    const sidebar = screen.getByRole("navigation", { name: "Steps" });
    const current = within(sidebar).getByRole("link", { current: "page" });
    expect(current).toHaveTextContent("Microhaplotypes");
    // Required steps are marked, and status is given in words.
    expect(current).toHaveTextContent("Required");
    expect(current).toHaveTextContent("Not started");

    await user.click(within(sidebar).getByRole("link", { name: /Panel/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Panel" })).toBeInTheDocument();
    expect(location.history.at(-1)).toBe("/panel");
    expect(within(sidebar).getByRole("link", { current: "page" })).toHaveTextContent("Panel");
  });

  it("links Back and Next in registry order", async () => {
    const { user } = renderAt("/panel");
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
    renderAt("/panel");
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
