import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { createDraftStorage } from "@/domain/draft";
import { createTestStore, renderWithStore } from "@/features/shared/testing";

import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("shows sections, step-list trigger, save status, privacy and options on Build", async () => {
    const onOpenNav = vi.fn<() => void>();
    const user = userEvent.setup();
    await renderWithStore(<TopBar onOpenNav={onOpenNav} showPublished />, {
      path: "/build/microhaplotypes",
    });

    const header = screen.getByRole("banner");
    expect(within(header).getByRole("link", { name: "PMO Builder" })).toHaveAttribute("href", "/");

    const nav = within(header).getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "Build" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(nav).getByRole("link", { name: "My PMO file" })).toHaveAttribute("href", "/pmo");
    expect(within(nav).getByRole("link", { name: "Published" })).toHaveAttribute(
      "href",
      "/published",
    );

    await user.click(within(header).getByRole("button", { name: "Open the step list" }));
    expect(onOpenNav).toHaveBeenCalledOnce();

    await user.click(within(header).getByRole("button", { name: "Draft saved" }));
    expect(await screen.findByText("Saved on this device")).toBeInTheDocument();

    expect(
      within(header).getByRole("button", { name: "Your data stays on this device" }),
    ).toBeInTheDocument();

    await user.click(within(header).getByRole("button", { name: "More options" }));
    expect(await screen.findByRole("menuitem", { name: "Start over" })).toBeInTheDocument();
  });

  it("hides the step-list trigger and save status outside Build", async () => {
    await renderWithStore(<TopBar onOpenNav={vi.fn<() => void>()} showPublished />, {
      path: "/pmo",
    });

    const header = screen.getByRole("banner");
    const nav = within(header).getByRole("navigation", { name: "Sections" });
    expect(within(nav).getByRole("link", { name: "My PMO file" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(header).queryByRole("button", { name: "Open the step list" }),
    ).not.toBeInTheDocument();
    expect(within(header).queryByRole("button", { name: "Draft saved" })).not.toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Your data stays on this device" }),
    ).toBeInTheDocument();
    expect(within(header).getByRole("button", { name: "More options" })).toBeInTheDocument();
  });

  it("keeps an accessible name and explanation on save-status warnings", async () => {
    const user = userEvent.setup();
    const store = createTestStore({
      storage: createDraftStorage({
        openBackend: () => {
          throw new Error("Private browsing blocked storage");
        },
      }),
    });
    await renderWithStore(<TopBar onOpenNav={vi.fn<() => void>()} showPublished />, {
      store,
      path: "/build/microhaplotypes",
    });

    const warning = screen.getByRole("button", { name: "Not kept after you close this tab" });
    await user.click(warning);
    expect(await screen.findByText("This browser is not keeping your work")).toBeInTheDocument();
  });
});
