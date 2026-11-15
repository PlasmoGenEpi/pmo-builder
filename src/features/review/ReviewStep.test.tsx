import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Notice } from "@/domain/types";
import { createTestStore, exampleFile, renderWithStore } from "@/features/shared/testing";
import type { AppActions, AppStore } from "@/state";

import { ReviewStep } from "./ReviewStep";
import { saveFile } from "./saveFile";

vi.mock("./saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));

const PMO_FILES = {
  gzip: { blob: new Blob(["gz"]), fileName: "Mad4hatter.pmo.json.gz" },
  json: { blob: new Blob(["{\n}"]), fileName: "Mad4hatter.pmo.json" },
};

/** A store whose download and preview actions are stubs, so tests can see how they are called. */
function storeWithStubs() {
  const store = createTestStore();
  const real = store.getState().actions;
  const downloadPmo = vi.fn<AppActions["downloadPmo"]>((options) =>
    Promise.resolve(options?.gzip === false ? PMO_FILES.json : PMO_FILES.gzip),
  );
  const previewPmo = vi.fn<AppActions["previewPmo"]>(() =>
    Promise.resolve({ text: '{\n  "pmo_header": {}\n}', truncated: false, length: 22 }),
  );
  const pmoFileSize = vi.fn<AppActions["pmoFileSize"]>((options) => {
    const file = options?.gzip === false ? PMO_FILES.json : PMO_FILES.gzip;
    return Promise.resolve({ fileName: file.fileName, size: file.blob.size });
  });
  store.setState({ actions: { ...real, downloadPmo, previewPmo, pmoFileSize } });
  return { store, downloadPmo, previewPmo, pmoFileSize };
}

async function loadExample(store: AppStore): Promise<void> {
  await act(async () => {
    const result = await store.getState().actions.loadExample();
    if (!result.ok) throw new Error(result.reason);
    await store.getState().actions.flush();
  });
}

/** Adds notices to the whole-draft part of the latest build. */
function addOverallNotices(
  store: AppStore,
  notices: readonly Notice[],
  pmo: "valid" | "invalid" = "valid",
): void {
  const view = store.getState().build.view;
  if (view === null) throw new Error("no build");
  act(() =>
    store.setState({
      build: {
        phase: "idle",
        view: {
          ...view,
          overall: { ...view.overall, status: pmo === "valid" ? "ready" : "error", pmo, notices },
        },
      },
    }),
  );
}

function verdict() {
  return screen.getByRole("region", { name: /ready|checking/i });
}

beforeEach(() => {
  vi.mocked(saveFile).mockClear();
});

describe("ReviewStep file sizes", () => {
  it("measures both files without downloading, and downloads only when asked", async () => {
    const { store, downloadPmo, pmoFileSize } = storeWithStubs();
    const user = userEvent.setup();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const card = verdict();
    expect(await within(card).findByText("Mad4hatter.pmo.json.gz, 2 B")).toBeInTheDocument();
    expect(within(card).getByText("Mad4hatter.pmo.json, 3 B")).toBeInTheDocument();
    // A rebuild measures again, still without a download.
    await act(async () => {
      store.getState().actions.setMode({ target: "project", mode: "table" });
      await store.getState().actions.flush();
    });
    await vi.waitFor(() => expect(pmoFileSize.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(downloadPmo).not.toHaveBeenCalled();

    await user.click(within(card).getByRole("button", { name: "Download PMO" }));
    expect(downloadPmo).toHaveBeenCalledTimes(1);
  });
});

describe("ReviewStep verdict", () => {
  it("says nothing has been added, with links to both required steps", async () => {
    const { store } = await renderWithStore(<ReviewStep />);
    await act(() => store.getState().actions.flush());
    const card = verdict();
    expect(within(card).getByRole("heading", { name: "Not ready yet" })).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Go to Microhaplotypes" })).toHaveAttribute(
      "href",
      "/build/microhaplotypes",
    );
    expect(within(card).getByRole("link", { name: "Go to Panel" })).toHaveAttribute(
      "href",
      "/build/panel",
    );
    expect(within(card).queryByRole("button", { name: "Download PMO" })).toBeNull();
  });

  it("names the missing panel when only the allele table is in", async () => {
    const { store } = await renderWithStore(<ReviewStep />);
    await act(async () => {
      await store
        .getState()
        .actions.importFile(
          { section: "microhaplotypes" },
          exampleFile("mad4hatter_allele_data_example.csv"),
        );
      await store.getState().actions.flush();
    });
    const card = verdict();
    expect(within(card).getByRole("heading", { name: "Not ready yet" })).toBeInTheDocument();
    expect(within(card).getByText(/is needed and has nothing in it yet/)).toHaveTextContent(
      "Panel is needed",
    );
    expect(within(card).getByRole("link", { name: "Go to Panel" })).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Go to Microhaplotypes" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Download PMO" })).toBeNull();
  });

  it("is ready for the example, with the merge summary", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const card = verdict();
    // The example names a project and a sequencing run that are not entered yet.
    expect(
      within(card).getByRole("heading", { name: "Ready, with things to check" }),
    ).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Download PMO" })).toBeInTheDocument();
    expect(await within(card).findByText("Mad4hatter.pmo.json.gz, 2 B")).toBeInTheDocument();

    const contents = screen.getByRole("region", { name: "What is in the PMO" });
    const samples = within(contents).getByRole("region", { name: "Samples" });
    expect(within(samples).getByText("Specimens").nextSibling).toHaveTextContent("50");
    const panel = within(contents).getByRole("region", { name: "Panel" });
    expect(within(panel).getByText("Targets").nextSibling).toHaveTextContent("276");
    expect(within(panel).getByText("Targets with alleles").nextSibling).toHaveTextContent("21");

    const check = screen.getByRole("region", { name: "Things to check" });
    expect(within(check).getByText("Project names that link to nothing")).toBeInTheDocument();
    expect(
      within(check).getByText("Sequencing run names that link to nothing"),
    ).toBeInTheDocument();
    expect(
      within(check).getByText(/names the project "PRJNA1040019", but no project is entered/),
    ).toBeInTheDocument();
  });

  it("is ready with things to check when there are warnings, and still downloads", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    addOverallNotices(store, [
      {
        severity: "warning",
        code: "draft/section-left-out",
        message: "Project is not finished, so it is left out of the PMO.",
        sections: ["project"],
      },
    ]);
    const card = verdict();
    expect(
      within(card).getByRole("heading", { name: "Ready, with things to check" }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/There is 1 warning worth a look/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Download PMO" })).toBeInTheDocument();
  });

  it("says a PMO that fails the format check can still be downloaded", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    addOverallNotices(
      store,
      [
        {
          severity: "error",
          code: "schema/required",
          message: 'Specimen "S1" is missing collection_country.',
          sections: ["specimens"],
        },
      ],
      "invalid",
    );
    const card = verdict();
    expect(
      within(card).getByRole("heading", { name: "Ready, with things to check" }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/does not fully match the PMO format/)).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Download PMO" })).toBeInTheDocument();
  });

  it("counts schema problems, not the line that says more are not listed", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const view = store.getState().build.view;
    if (view === null) throw new Error("no build");
    const notices: readonly Notice[] = [
      {
        severity: "error",
        code: "schema/type",
        message: 'Specimen "S1", field "host_taxon_id" is "human".',
        sections: ["specimens"],
        path: "/specimen_info/0/host_taxon_id",
      },
      {
        severity: "error",
        code: "schema/more",
        message: "4 more problems with the PMO format are not listed.",
        sections: [],
      },
    ];
    act(() =>
      store.setState({
        build: {
          phase: "idle",
          view: {
            ...view,
            overall: { ...view.overall, status: "error", pmo: "invalid", notices, schemaErrors: 5 },
          },
        },
      }),
    );
    expect(within(verdict()).getByText(/See the 5 problems below/)).toBeInTheDocument();
    const check = screen.getByRole("region", { name: "Things to check" });
    // The words lead; the place in the file follows as a detail.
    const item = within(check)
      .getByText(/^Specimen "S1"/)
      .closest("li");
    expect(item?.firstElementChild).toHaveTextContent(
      'Specimen "S1", field "host_taxon_id" is "human".',
    );
    expect(
      within(check).getByText("/specimen_info/0/host_taxon_id").parentElement,
    ).toHaveTextContent("Details: place in the PMO file /specimen_info/0/host_taxon_id");
    expect(within(check).queryByText(/In the file at/)).toBeNull();
  });

  it("keeps the last result on screen while a rebuild runs", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const view = store.getState().build.view;
    act(() => store.setState({ build: { phase: "pending", view } }));
    const card = verdict();
    expect(card).toHaveAttribute("aria-busy", "true");
    expect(within(card).getByText("Updating")).toBeInTheDocument();
    expect(
      within(card).getByRole("heading", { name: "Ready, with things to check" }),
    ).toBeInTheDocument();
  });
});

describe("ReviewStep checklist", () => {
  it("lists every section with its state, a summary and a link", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const list = screen.getByRole("region", { name: "Steps" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(8);
    const row = (title: string) => {
      const item = items.find((candidate) =>
        within(candidate).queryByRole("link", { name: title }),
      );
      if (item === undefined) throw new Error(`no row for ${title}`);
      return item;
    };
    expect(row("Microhaplotypes")).toHaveTextContent(
      "981 allele calls for 49 samples at 21 targets, 107 distinct alleles",
    );
    expect(row("Microhaplotypes")).toHaveTextContent("Ready");
    expect(row("Panel")).toHaveTextContent('Panel "Mad4hatter" with 276 targets, no genome');
    expect(row("Specimens")).toHaveTextContent("50 specimens");
    expect(row("Project")).toHaveTextContent("Not added");
    expect(within(row("Read counts by stage")).getByRole("link")).toHaveAttribute(
      "href",
      "/build/read-counts",
    );
  });

  it("shows an unfinished optional section as left out, not as an error", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const view = store.getState().build.view;
    if (view === null) throw new Error("no build");
    act(() =>
      store.setState({
        build: {
          phase: "idle",
          view: {
            ...view,
            sections: {
              ...view.sections,
              project: {
                status: "incomplete",
                notices: [{ severity: "error", code: "form/missing-required", message: "x" }],
                summary: null,
              },
            },
          },
        },
      }),
    );
    const list = screen.getByRole("region", { name: "Steps" });
    const project = within(list)
      .getAllByRole("listitem")
      .find((item) => within(item).queryByRole("link", { name: "Project" }));
    expect(project).toHaveTextContent("Left out");
    expect(project).toHaveTextContent("Not finished, so it is left out of the PMO.");
    expect(project).not.toHaveTextContent("Has errors");
  });
});

describe("ReviewStep things to check", () => {
  it("groups notices by kind, errors first, with counts, expandable lists and step links", async () => {
    const { store } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    addOverallNotices(
      store,
      [
        {
          severity: "warning",
          code: "draft/section-left-out",
          message: "Sequencing is not finished, so it is left out of the PMO.",
          sections: ["sequencing"],
        },
        ...["S1", "S2", "S3"].map((name): Notice => ({
          severity: "error",
          code: "schema/required",
          message: `Specimen "${name}" is missing collection_country.`,
          sections: ["specimens"],
        })),
      ],
      "invalid",
    );
    const check = screen.getByRole("region", { name: "Things to check" });
    const text = check.textContent ?? "";
    expect(text.indexOf("Fields the PMO format needs are missing")).toBeLessThan(
      text.indexOf("Left out because they are not finished"),
    );
    expect(within(check).getByText("3")).toBeInTheDocument();
    expect(within(check).getByText('Specimen "S1" is missing collection_country.')).toBeVisible();
    expect(within(check).queryByText('Specimen "S3" is missing collection_country.')).toBeNull();
    expect(within(check).getByRole("link", { name: "Fix on Specimens" })).toHaveAttribute(
      "href",
      "/build/specimens",
    );
    expect(within(check).getByRole("link", { name: "Fix on Sequencing" })).toHaveAttribute(
      "href",
      "/build/sequencing",
    );

    await userEvent.click(within(check).getByRole("button", { name: "Show all 3" }));
    expect(within(check).getByText('Specimen "S3" is missing collection_country.')).toBeVisible();
    expect(within(check).getByRole("button", { name: "Show fewer" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });
});

describe("ReviewStep downloads", () => {
  it("downloads the gzipped file from the primary button", async () => {
    const { store, downloadPmo } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    downloadPmo.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Download PMO" }));
    expect(downloadPmo).toHaveBeenCalledExactlyOnceWith({ gzip: true });
    expect(saveFile).toHaveBeenCalledWith(PMO_FILES.gzip.blob, "Mad4hatter.pmo.json.gz");
  });

  it("downloads plain JSON from the secondary button, showing its name and size", async () => {
    const { store, downloadPmo } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    expect(await screen.findByText("Mad4hatter.pmo.json, 3 B")).toBeInTheDocument();
    downloadPmo.mockClear();
    await userEvent.click(screen.getByRole("button", { name: "Download as plain JSON" }));
    expect(downloadPmo).toHaveBeenCalledExactlyOnceWith({ gzip: false });
    expect(saveFile).toHaveBeenCalledWith(PMO_FILES.json.blob, "Mad4hatter.pmo.json");
  });
});

describe("ReviewStep preview", () => {
  it("loads the PMO text only when the preview is opened", async () => {
    const { store, previewPmo } = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store });
    await loadExample(store);
    const toggle = screen.getByRole("button", { name: /Preview the PMO/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(previewPmo).not.toHaveBeenCalled();
    await userEvent.click(toggle);
    expect(await screen.findByRole("region", { name: "PMO preview" })).toHaveTextContent(
      '"pmo_header"',
    );
    expect(previewPmo).toHaveBeenCalled();
  });

  it("offers no preview while there is no PMO", async () => {
    const { store } = await renderWithStore(<ReviewStep />);
    await act(() => store.getState().actions.flush());
    expect(screen.queryByRole("button", { name: /Preview the PMO/ })).toBeNull();
  });
});

describe("ReviewStep what next", () => {
  it("links to the PMO documentation in a new tab without a referrer", async () => {
    await renderWithStore(<ReviewStep />);
    const link = screen.getByRole("link", { name: /PMO documentation/ });
    expect(link).toHaveAttribute("href", "https://plasmogenepi.github.io/PMO_Docs/");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });
});
