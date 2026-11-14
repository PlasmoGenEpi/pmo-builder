import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { exampleFile, renderWithStore } from "@/features/shared/testing";

import { PanelStep } from "./PanelStep";

const EXAMPLE = "mad4hatter_panel_info_example.csv";
const READY = "This part is ready to go into the PMO.";

async function setup() {
  const user = userEvent.setup();
  const rendered = await renderWithStore(<PanelStep />, { path: "/panel" });
  return { ...rendered, user };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Names the panel and adds the example target table. */
async function loadExample(
  { user }: Setup,
  name: string | null = "Mad4hatter",
  scope = document.body,
) {
  const area = within(scope);
  if (name !== null) await user.type(area.getByRole("textbox", { name: /Panel name/ }), name);
  await user.upload(area.getByLabelText("Choose target table file"), exampleFile(EXAMPLE));
  await area.findByText(EXAMPLE);
}

function result() {
  return within(screen.getByRole("region", { name: /Result/ }));
}

describe("PanelStep", () => {
  it("starts with a name and a file, and nothing else", async () => {
    await setup();
    expect(screen.getByRole("textbox", { name: /Panel name/ })).toHaveValue("");
    expect(screen.getByLabelText("Choose target table file")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add another panel" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /Reference genome/ })).toBeNull();
    expect(screen.queryByText(/Use a panel you saved before/)).toBeNull();
    await waitFor(() => expect(result().getByText(/Nothing here yet/)).toBeInTheDocument());
  });

  it("builds one panel from the example file", async () => {
    const setupResult = await setup();
    await loadExample(setupResult);
    expect(screen.getByText(/3 of 3 required fields matched/)).toBeInTheDocument();
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    expect(result().getByText("276")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Reference genome/ })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save this panel for next time" }),
    ).toBeInTheDocument();
  });

  it("asks for a name when the panel has none", async () => {
    const setupResult = await setup();
    await loadExample(setupResult, null);
    const name = screen.getByRole("textbox", { name: /Panel name/ });
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    expect(screen.getAllByText(/Give the panel a name/).length).toBeGreaterThan(0);
    expect(result().getByText(/Something this part needs is missing/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save this panel for next time" })).toBeNull();
  });

  it("shows the genome fields when the genome is entered by hand", async () => {
    const setupResult = await setup();
    const { user } = setupResult;
    await loadExample(setupResult);
    expect(screen.queryByRole("textbox", { name: /Genome name/ })).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Enter by hand" }));
    const genomeName = screen.getByRole("textbox", { name: /Genome name/ });
    for (const label of [/Genome name/, /Genome version/, /Taxon ID/, /Genome link/]) {
      expect(screen.getByRole("textbox", { name: label })).toBeRequired();
    }
    expect(screen.getByRole("textbox", { name: /Annotation link/ })).not.toBeRequired();
    await user.type(genomeName, "3D7");
    expect(screen.queryByText(/Fill this in/)).toBeNull();
    await user.click(screen.getByRole("textbox", { name: /Genome version/ }));
    await user.tab();
    expect(
      screen.getByText(/Fill this in, or set the reference genome to None/),
    ).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: /Taxon ID/ }), "abc");
    expect(screen.getByText(/Taxon ID has "abc"/)).toBeInTheDocument();
    await waitFor(() => expect(result().queryByText(READY)).toBeNull());
  });

  it("adds a second panel as a card and removes it after asking", async () => {
    const setupResult = await setup();
    const { user } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Add another panel" }));

    const removeButtons = screen.getAllByRole("button", { name: "Remove this panel" });
    // The first panel is ready, so its card starts closed; the new one is open.
    expect(removeButtons).toHaveLength(1);
    expect(screen.getByRole("button", { name: /Mad4hatter/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Panel 2/ })).toBeInTheDocument();
    expect(screen.getByText(/panels that share targets are merged/)).toBeInTheDocument();

    const second = removeButtons[0]?.closest("li");
    if (second === null || second === undefined) throw new Error("No second panel");
    await user.click(within(second).getByRole("button", { name: "Remove this panel" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/Remove the panel "Panel 2"/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove panel" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /Panel 2/ })).toBeNull());
    expect(setupResult.store.getState().draft.panel.panels).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Remove this panel" })).toBeNull();
  });

  it("saves a panel and applies it to a new draft", async () => {
    const setupResult = await setup();
    const { user, store } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save this panel for next time" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    await act(() => store.getState().actions.startOver());
    const offer = within(
      await screen.findByRole("region", { name: "Use a panel you saved before" }),
    );
    expect(offer.getByText("Mad4hatter")).toBeInTheDocument();
    expect(offer.getByText(/276 targets, saved/)).toBeInTheDocument();

    await user.click(offer.getByRole("button", { name: "Use the saved panel Mad4hatter" }));
    expect(await screen.findByText(/Using the saved panel/)).toBeInTheDocument();
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    expect(store.getState().draft.panel.panels[0]?.source).toBe("saved");
  });

  it("deletes a saved panel after asking", async () => {
    const setupResult = await setup();
    const { user, store } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await act(async () => {
      const panelId = store.getState().draft.panel.panels[0]?.id ?? "";
      await store.getState().actions.savePanelToLibrary(panelId);
      await store.getState().actions.startOver();
    });

    const offer = within(
      await screen.findByRole("region", { name: "Use a panel you saved before" }),
    );
    await user.click(offer.getByRole("button", { name: "Delete the saved panel Mad4hatter" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete panel" }));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Use a panel you saved before" })).toBeNull(),
    );
    expect(store.getState().savedPanels).toEqual({ kind: "ready", panels: [] });
  });

  it("knows a panel is saved from the library, after leaving the page too", async () => {
    const setupResult = await setup();
    const { user, store, unmount } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save this panel for next time" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();

    unmount();
    await renderWithStore(<PanelStep />, { store, path: "/panel" });
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save this panel for next time" })).toBeNull();
  });

  it("offers to replace a saved panel with the same name and other content", async () => {
    const setupResult = await setup();
    const { user, store } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Save this panel for next time" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const before = store.getState().savedPanels;
    const firstId = before.kind === "ready" ? (before.panels[0]?.id ?? "") : "";

    // Same name, other content: map an extra column into the panel.
    const entry = store.getState().draft.panel.panels[0];
    const mapping = entry?.table?.mapping;
    if (entry === undefined || mapping === undefined) throw new Error("no panel table");
    act(() =>
      store
        .getState()
        .actions.setMapping(
          { section: "panel", panelId: entry.id, part: "targets" },
          { ...mapping, additionalColumns: ["amplicon_length"] },
        ),
    );
    const save = await screen.findByRole("button", { name: "Save this panel for next time" });
    await user.click(save);
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText('Replace the saved panel "Mad4hatter"?')).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Replace saved panel" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    const library = store.getState().savedPanels;
    expect(library.kind === "ready" ? library.panels.map((panel) => panel.id) : []).toEqual([
      firstId,
    ]);
  });

  it("renames a panel taken from the library, in the draft only", async () => {
    const setupResult = await setup();
    const { user, store } = setupResult;
    await loadExample(setupResult);
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await act(async () => {
      const panelId = store.getState().draft.panel.panels[0]?.id ?? "";
      await store.getState().actions.savePanelToLibrary(panelId);
      await store.getState().actions.startOver();
    });
    const offer = within(
      await screen.findByRole("region", { name: "Use a panel you saved before" }),
    );
    await user.click(offer.getByRole("button", { name: "Use the saved panel Mad4hatter" }));
    const name = await screen.findByRole("textbox", { name: /Panel name/ });
    expect(name).toHaveValue("Mad4hatter");

    await user.clear(name);
    await user.type(name, "MH_v2");
    await waitFor(() => expect(result().getByText(READY)).toBeInTheDocument());
    await waitFor(() => expect(result().getByText("MH_v2")).toBeInTheDocument());
    expect(store.getState().draft.panel.panels[0]?.saved?.name).toBe("MH_v2");
    const library = store.getState().savedPanels;
    expect(library.kind === "ready" ? library.panels.map((panel) => panel.name) : []).toEqual([
      "Mad4hatter",
    ]);
    // It still says which saved panel it came from.
    expect(screen.getByText(/Using the saved panel/)).toHaveTextContent(
      "Using the saved panel Mad4hatter",
    );
    // Renamed, it is a different panel from the saved one, so saving it is offered.
    expect(
      await screen.findByRole("button", { name: "Save this panel for next time" }),
    ).toBeInTheDocument();
  });
});
