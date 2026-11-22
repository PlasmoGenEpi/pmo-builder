import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";

import { readPmoFile } from "@/domain/build/checkFile";
import { buildExamplePmo } from "@/domain/build/testing";
import { examplePmoWithReadCounts, richPmo } from "@/domain/tools/testing";
import { readZip } from "@/domain/tools/zipTesting";
import { saveFile } from "@/features/review/saveFile";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { signIn } from "@/features/review/zenodoAuth";
import { depositDraft } from "@/features/review/zenodoDeposit";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";
import { installBlobStream } from "@/test/blobStream";
import type { WorkingPmoKind, WorkingPmoResult } from "@/domain/tools/types";
import { EngineStoppedError, type Engine } from "@/worker";
import { createInThreadEngine } from "@/worker/engine";

import { OPEN_BUILT_PATH, PmoFilePage, PmoFileRoute, PMO_TABS, type PmoTab } from "./PmoFilePage";
import { TablesPanel } from "./TablesPanel";
import { CompareTab } from "./summary/CompareTab";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));
vi.mock("@/features/review/zenodoAuth", () => ({ signIn: vi.fn<typeof signIn>() }));
vi.mock("@/features/review/zenodoDeposit", () => ({
  depositDraft: vi.fn<typeof depositDraft>(),
}));

const ZENODO: ZenodoConfig = {
  community: "pmocommunity",
  communityName: "PMO",
  clientId: "client-1",
};

const EXAMPLE = buildExamplePmo();

/** The example PMO with its own sample names, so it does not count as the example. */
function ownPmo(): PortableMicrohaplotypeObject {
  return {
    ...EXAMPLE,
    library_sample_info: EXAMPLE.library_sample_info.map((sample, index) =>
      Object.assign({}, sample, { library_sample_name: `lab_sample_${index + 1}` }),
    ),
  };
}

function pmoFile(data: unknown, name = "study.json"): File {
  return new File([typeof data === "string" ? data : stringifyPmo(data)], name);
}

function isTab(value: string | undefined): value is PmoTab {
  return PMO_TABS.some((tab) => tab === value);
}

/** The page under its routes, as the app has it, so tabs change the address. */
async function renderPage(zenodo: ZenodoConfig | null = ZENODO, store = createTestStore()) {
  const user = userEvent.setup();
  const rendered = await renderWithStore(
    <Switch>
      <Route path="/pmo">
        <PmoFilePage zenodo={zenodo} />
      </Route>
      <Route path="/pmo/:tab">
        {(params: { tab?: string }) => (
          <PmoFilePage zenodo={zenodo} tab={isTab(params.tab) ? params.tab : "overview"} />
        )}
      </Route>
    </Switch>,
    { store, path: "/pmo" },
  );
  return { user, ...rendered };
}

async function open(file: File, zenodo: ZenodoConfig | null = ZENODO) {
  const rendered = await renderPage(zenodo);
  await rendered.user.upload(screen.getByLabelText("Choose pmo file"), file);
  return rendered;
}

/** A promise that resolves when told to. */
class Gate {
  #resolve: () => void = () => undefined;
  readonly promise = new Promise<void>((resolve) => {
    this.#resolve = resolve;
  });

  open(): void {
    this.#resolve();
  }
}

async function savedText(): Promise<{ readonly name: string; readonly text: string }> {
  const call = vi.mocked(saveFile).mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing saved");
  const [blob, name] = call;
  return { name, text: await blob.text() };
}

async function savedSpecimenNames(): Promise<unknown[]> {
  const parsed: unknown = JSON.parse((await savedText()).text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("specimen_info" in parsed) ||
    !Array.isArray(parsed.specimen_info)
  ) {
    return [];
  }
  return parsed.specimen_info.map((item: unknown) =>
    typeof item === "object" && item !== null && "specimen_name" in item
      ? item.specimen_name
      : null,
  );
}

beforeEach(() => {
  vi.mocked(saveFile).mockReset();
  vi.mocked(signIn).mockReset();
  vi.mocked(depositDraft).mockReset();
});

describe("PmoFilePage: opening", () => {
  it("opens a valid file on its overview, leaving the draft alone", async () => {
    const { store } = await open(pmoFile(ownPmo()));
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Publish to Zenodo" })).toBeInTheDocument();
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
  });

  it("refuses a file in another PMO version", async () => {
    const old = { ...EXAMPLE, pmo_header: { ...EXAMPLE.pmo_header, pmo_version: "1.0.0" } };
    await open(pmoFile(old));
    expect(
      await screen.findByText(/This file is in PMO version 1\.0\.0\. Only version 1\.1\.0 files/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("lists what does not match the PMO format, with a way to build one", async () => {
    const broken = {
      ...EXAMPLE,
      specimen_info: EXAMPLE.specimen_info.map(({ specimen_name: _name, ...rest }) => rest),
    };
    await open(pmoFile(JSON.stringify(broken)));
    expect(await screen.findByText("This file does not match the PMO format")).toBeInTheDocument();
    expect(screen.getByText(/specimen_name.*\(and \d+ more like it\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/build");
  });

  it("says when a file is not a PMO at all, and lets the user choose another", async () => {
    const { user } = await open(pmoFile("sample,reads\ns1,10\n", "table.json"));
    expect(await screen.findByText(/This is not a PMO file/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove pmo file" }));
    await act(() => Promise.resolve());
    expect(screen.queryByText(/This is not a PMO file/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose pmo file")).toBeInTheDocument();
  });

  it("keeps the file open when the page is left and opened again", async () => {
    const first = await open(pmoFile(ownPmo()));
    await screen.findByText("This file is a valid PMO");
    first.unmount();
    await renderPage(ZENODO, first.store);
    expect(screen.getByText("This file is a valid PMO")).toBeInTheDocument();
    expect(screen.getByText("study.json")).toBeInTheDocument();
  });
});

describe("PmoFilePage: opening the built PMO", () => {
  it("finishes opening the built PMO when the page is left meanwhile", async () => {
    installBlobStream();
    const store = createTestStore();
    await store.getState().actions.initialise();
    await act(() => store.getState().actions.loadExample());
    await act(() => store.getState().actions.flush());
    const routes = (
      <Switch>
        <Route path="/pmo">
          <PmoFilePage zenodo={ZENODO} />
        </Route>
        <Route path="/pmo/:tab">
          <PmoFileRoute />
        </Route>
      </Switch>
    );
    const opening = await renderWithStore(routes, { store, path: OPEN_BUILT_PATH });
    expect(screen.getByText("Opening the PMO built from your draft")).toBeInTheDocument();
    // Left before the open finishes.
    opening.unmount();
    await renderWithStore(routes, { store, path: "/pmo" });
    expect(await screen.findByText("This is the PMO built from your draft")).toBeInTheDocument();
    expect(screen.queryByText("Opening the file")).not.toBeInTheDocument();
  });
});

describe("PmoFilePage: when the built PMO cannot be opened", () => {
  const ROUTES = (
    <Switch>
      <Route path="/pmo">
        <PmoFilePage zenodo={ZENODO} />
      </Route>
      <Route path="/pmo/:tab">
        <PmoFileRoute />
      </Route>
    </Switch>
  );

  it("says there is no built PMO when the draft builds none", async () => {
    await renderWithStore(ROUTES, { path: OPEN_BUILT_PATH });
    expect(await screen.findByText("There is no built PMO to open")).toBeInTheDocument();
  });

  it("says the built PMO could not be opened when exporting it fails", async () => {
    const engine = createInThreadEngine();
    const broken: Engine = {
      ...engine,
      getPmoFile: () => Promise.reject(new Error("out of memory")),
    };
    await renderWithStore(ROUTES, {
      store: createTestStore({ engine: broken }),
      path: OPEN_BUILT_PATH,
    });
    expect(
      await screen.findByText("The file could not be opened. Reload the page and try again."),
    ).toBeInTheDocument();
    expect(screen.queryByText("There is no built PMO to open")).not.toBeInTheDocument();
  });
});

describe("PmoFilePage: tables", () => {
  it("downloads the allele table as CSV", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-alleles.csv");
    expect(text.split("\n")[0]).toBe(
      "library_sample_name,target_name,seq,bioinformatics_run_name,reads",
    );
  });

  it("downloads a table as TSV", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("radio", { name: "TSV" }));
    await user.click(screen.getByRole("button", { name: "Download Specimens as tsv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-specimens.tsv");
    expect(text.split("\n")[0]).toContain("\t");
  });

  it("downloads every table in one zip", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("button", { name: "Download all tables (.zip)" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const [blob, name] = vi.mocked(saveFile).mock.calls.at(-1) ?? [];
    expect(name).toBe("study-tables-csv.zip");
    if (blob === undefined) throw new Error("nothing saved");
    const files = await readZip(blob);
    expect(files.map((file) => file.name)).toContain("study-alleles.csv");
    // One file per table listed, each with its own Download button.
    expect(files).toHaveLength(
      screen.getAllByRole("button", { name: /^Download .* as csv$/ }).length,
    );
  });

  it("says no subset has been made yet when asked for the subset's tables first", async () => {
    const store = createTestStore();
    const file = pmoFile(EXAMPLE);
    await workingPmoSessionOf(store).open({
      kind: "file",
      file,
      name: file.name,
      origin: { kind: "chosen" },
    });
    const user = userEvent.setup();
    const listed = [{ id: "alleles", rows: 1 }] as const;
    await renderWithStore(<TablesPanel tables={listed} subsetTables={listed} source="subset" />, {
      store,
    });
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download all tables (.zip)" }));
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();
    // The switch is hidden while no subset exists, so it is not what to use.
    expect(
      screen.getByText(
        "Make one on the Subset tab. Until then, only the original's tables can be downloaded.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not be made/)).not.toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("lists and downloads read counts by stage on the example PMO, and includes it in the zip", async () => {
    const { user } = await open(pmoFile(examplePmoWithReadCounts()));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    const downloadButton = screen.getByRole("button", {
      name: "Download Read counts by stage as csv",
    });
    const row = downloadButton.closest("li");
    if (row === null) throw new Error("expected list item");
    expect(within(row).getByText("Read counts by stage")).toBeInTheDocument();
    expect(
      within(row).getByText(
        "One row per library sample, target and pipeline stage, with total raw reads.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getByText("8 rows")).toBeInTheDocument();

    await user.click(downloadButton);
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const csv = await savedText();
    expect(csv.name).toBe("study-read-counts.csv");
    expect(csv.text.trimEnd().split("\n")[0]).toBe(
      "library_sample_name,total_raw_count,target_name,stage,reads",
    );
    expect(csv.text.trimEnd().split("\n")).toHaveLength(9);

    vi.mocked(saveFile).mockReset();
    await user.click(screen.getByRole("radio", { name: "TSV" }));
    await user.click(screen.getByRole("button", { name: "Download Read counts by stage as tsv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const tsv = await savedText();
    expect(tsv.name).toBe("study-read-counts.tsv");
    expect(tsv.text.trimEnd().split("\n")[0]).toBe(
      "library_sample_name\ttotal_raw_count\ttarget_name\tstage\treads",
    );

    vi.mocked(saveFile).mockReset();
    await user.click(screen.getByRole("button", { name: "Download all tables (.zip)" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const [blob] = vi.mocked(saveFile).mock.calls.at(-1) ?? [];
    if (blob === undefined) throw new Error("nothing saved");
    const files = await readZip(blob);
    expect(files.map((file) => file.name)).toContain("study-read-counts.tsv");
  });

  it("does not list read counts by stage when the PMO has none", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    expect(screen.queryByText("Read counts by stage")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^Download Read counts by stage/ }),
    ).not.toBeInTheDocument();
  });

  it("updates or hides read counts by stage when switching between original and subset", async () => {
    const { user } = await open(pmoFile(richPmo()));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    expect(screen.getByText("Read counts by stage")).toBeInTheDocument();
    const originalItem = screen
      .getByRole("button", { name: "Download Read counts by stage as csv" })
      .closest("li");
    if (originalItem === null) throw new Error("expected list item");
    expect(within(originalItem).getByText("3 rows")).toBeInTheDocument();

    // Subset to spec2, which has no read counts.
    await user.click(screen.getByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    const specimens = screen.getByRole("group", { name: "Specimens" });
    await user.click(within(specimens).getByRole("checkbox", { name: /spec2/ }));
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");

    await user.click(screen.getByRole("tab", { name: "Tables" }));
    expect(screen.getByRole("radio", { name: "Subset" })).toBeChecked();
    expect(screen.queryByText("Read counts by stage")).not.toBeInTheDocument();

    // Switching back to Original brings it back.
    await user.click(screen.getByRole("radio", { name: "Original" }));
    expect(screen.getByText("Read counts by stage")).toBeInTheDocument();
  });

  it("loads a table preview only when opened, shows a loading state, then renders the first 20 rows and toggles from the keyboard", async () => {
    const engine = createInThreadEngine();
    const held = new Gate();
    const kinds: string[] = [];
    const { user } = await openWithEngine(pmoFile(EXAMPLE), {
      ...engine,
      workingPmo: async (call) => {
        kinds.push(call.request.kind);
        if (call.request.kind === "tablePreview") await held.promise;
        return engine.workingPmo(call);
      },
    });
    await user.click(await screen.findByRole("tab", { name: "Tables" }));

    // Opening the tab does not request any table preview yet.
    expect(kinds).not.toContain("tablePreview");

    const toggle = screen.getByRole("button", { name: "Preview Allele table" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    toggle.focus();
    await user.keyboard("{Enter}");

    expect(kinds).toContain("tablePreview");
    expect(await screen.findByText("Loading preview")).toBeInTheDocument();
    const hideToggle = screen.getByRole("button", { name: "Hide preview of Allele table" });
    expect(hideToggle).toHaveAttribute("aria-expanded", "true");

    await act(async () => held.open());

    const previewRegion = await screen.findByRole("region", { name: "Preview of Allele table" });
    expect(previewRegion).toHaveAttribute("tabindex", "0");
    const table = within(previewRegion).getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      "Row#",
      "library_sample_name",
      "target_name",
      "seq",
      "bioinformatics_run_name",
      "reads",
    ]);
    // 1 header row + 20 preview rows.
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(21);

    // Count line matches the whole allele table's row count.
    const alleleRowCount = EXAMPLE.detected_microhaplotypes.reduce(
      (sum, run) =>
        sum +
        run.library_samples.reduce(
          (sSum, sample) =>
            sSum + sample.target_results.reduce((tSum, result) => tSum + result.mhaps.length, 0),
          0,
        ),
      0,
    );
    expect(
      screen.getByText(`Showing 20 of ${alleleRowCount.toLocaleString("en")} rows`),
    ).toBeInTheDocument();

    // Closing from the keyboard removes the preview.
    hideToggle.focus();
    await user.keyboard(" ");
    expect(
      screen.queryByRole("region", { name: "Preview of Allele table" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Allele table" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  it("previews read counts by stage and single-row tables with their exact row count line", async () => {
    const { user } = await open(pmoFile(examplePmoWithReadCounts()));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));

    await user.click(screen.getByRole("button", { name: "Preview Read counts by stage" }));
    const countsRegion = await screen.findByRole("region", {
      name: "Preview of Read counts by stage",
    });
    const countsTable = within(countsRegion).getByRole("table");
    const countRows = within(countsTable).getAllByRole("row");
    expect(countRows).toHaveLength(9);
    const firstRow = countRows[1];
    if (firstRow === undefined) throw new Error("expected data row");
    expect(
      within(firstRow)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["example_sample_01", "10", "Pf3D7_01_v3-145388-145662-1A", "demux", "10"]);
    expect(screen.getByText("Showing 8 of 8 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview File header" }));
    expect(
      await screen.findByRole("region", { name: "Preview of File header" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Showing 1 of 1 row")).toBeInTheDocument();
  });

  it("updates an open preview when switching between Original and Subset", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await makeSubset(user, 3);
    await user.click(screen.getByRole("tab", { name: "Tables" }));
    expect(screen.getByRole("radio", { name: "Subset" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Preview Specimens" }));
    const subsetRegion = await screen.findByRole("region", { name: "Preview of Specimens" });
    expect(within(subsetRegion).getAllByRole("row")).toHaveLength(4);
    expect(screen.getByText("Showing 3 of 3 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Original" }));
    expect(
      await screen.findByText(`Showing 20 of ${EXAMPLE.specimen_info.length} rows`),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Preview of Specimens" })).getAllByRole("row"),
    ).toHaveLength(21);
  });

  it("shows an accessible notice when a table preview fails", async () => {
    const { engine } = watchedEngine((kind) =>
      kind === "tablePreview" ? { kind: "failed", message: "out of memory" } : null,
    );
    const { user } = await openWithEngine(pmoFile(EXAMPLE), engine);
    await user.click(await screen.findByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("button", { name: "Preview Allele table" }));
    expect(await screen.findByText("The preview could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText(/out of memory/)).not.toBeInTheDocument();
  });

  it("formats boolean cells in table previews as True/False to match the downloaded CSV", async () => {
    const base = richPmo();
    const withBooleans: PortableMicrohaplotypeObject = {
      ...base,
      specimen_info: [
        { ...base.specimen_info[0], specimen_name: "spec1", has_symptoms: true },
        { ...base.specimen_info[1], specimen_name: "spec2", has_symptoms: false },
        { ...base.specimen_info[2], specimen_name: "neg" },
      ],
    };
    const { user } = await open(pmoFile(withBooleans));
    await user.click(await screen.findByRole("tab", { name: "Tables" }));

    await user.click(screen.getByRole("button", { name: "Preview Specimens" }));
    const previewRegion = await screen.findByRole("region", { name: "Preview of Specimens" });
    const table = within(previewRegion).getByRole("table");
    const headers = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    // Subtract 1 because the first columnheader is the sticky row-number column (`Row#`).
    const boolIndex = headers.indexOf("has_symptoms") - 1;
    expect(boolIndex).toBeGreaterThanOrEqual(0);
    const previewBooleans = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("cell")[boolIndex]?.textContent);
    expect(previewBooleans).toEqual(["True", "False", "blank"]);
    expect(screen.getByText("Showing 3 of 3 rows")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download Specimens as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { text } = await savedText();
    const [headerLine, ...dataLines] = text.trimEnd().split("\n");
    const csvBoolIndex = (headerLine ?? "").split(",").indexOf("has_symptoms");
    expect(csvBoolIndex).toBeGreaterThanOrEqual(0);
    expect(dataLines.map((line) => line.split(",")[csvBoolIndex])).toEqual(["True", "False", ""]);
  });
});

describe("PmoFilePage: subset", () => {
  it("makes a subset of ticked specimens and downloads it", async () => {
    const { user } = await open(pmoFile(EXAMPLE, "study.json.gz"));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    const make = screen.getByRole("button", { name: "Make the subset" });
    expect(make).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    const specimens = screen.getByRole("group", { name: "Specimens" });
    const boxes = within(specimens).getAllByRole("checkbox");
    // One click after another, as a person would tick them.
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(0, 3)) await user.click(box);
    expect(screen.getByText(/^3 of \d+ specimens kept\.$/)).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^The subset will keep 3 of \d+ specimens and 3 of \d+ library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();
    await user.click(make);
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();
    expect(
      screen.getByText(
        /^It keeps 3 of \d+ specimens and 3 of \d+ library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-subset.json");
    const subset: unknown = JSON.parse(text);
    expect(subset).toMatchObject({ specimen_info: [{}, {}, {}] });
  });

  it("replaces the first subset with the second", async () => {
    const { user } = await open(pmoFile(EXAMPLE, "study.json.gz"));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    const boxes = within(screen.getByRole("group", { name: "Specimens" })).getAllByRole("checkbox");
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(0, 3)) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText(/^It keeps 3 of \d+ specimens/);
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(3, 4)) await user.click(box);
    expect(screen.queryByText("The subset is ready")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    expect(await screen.findByText(/^It keeps 4 of \d+ specimens/)).toBeInTheDocument();

    // The page goes on offering the subset after leaving the tab and coming back.
    await user.click(screen.getByRole("tab", { name: "Overview" }));
    await user.click(screen.getByRole("tab", { name: "Subset" }));
    expect(await screen.findByText(/^It keeps 4 of \d+ specimens/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const subset: unknown = JSON.parse((await savedText()).text);
    expect(subset).toMatchObject({ specimen_info: [{}, {}, {}, {}] });
  });

  it("keeps the subset made while new choices are being made", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "100");
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "0");
    expect(screen.queryByText("The subset is ready")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Tables" }));
    expect(await screen.findByRole("radio", { name: "Subset" })).toBeInTheDocument();
  });

  it("says before making it when nothing would be left", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "100000000");
    expect(
      await screen.findByText(
        /^No library sample has any microhaplotypes left with these choices\./,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make the subset" })).toBeDisabled();
  });

  it("shows the subset's tables once it is made", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "100");
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");
    await user.click(screen.getByRole("button", { name: "Download its tables" }));
    expect(await screen.findByRole("radio", { name: "Subset" })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-subset-alleles.csv");
    const reads = text
      .trimEnd()
      .split("\n")
      .slice(1)
      .map((line) => Number(line.split(",").at(-1)));
    expect(Math.min(...reads)).toBeGreaterThanOrEqual(100);
  });

  it("names metadata fields in plain words matching Compare, and keeps PMO names for unknown fields", async () => {
    const base = richPmo();
    const withFields: PortableMicrohaplotypeObject = {
      ...base,
      project_info: [
        { project_name: "Study A", project_description: "a" },
        { project_name: "Study B", project_description: "b" },
      ],
      specimen_info: [
        {
          ...base.specimen_info[0],
          specimen_name: "spec1",
          collection_country: "Mozambique",
          geo_admin1: "Maputo",
          collection_date: "2019-01-15",
          project_id: 0,
          specimen_type: "field_sample",
          study_arm: "arm_a",
        },
        {
          ...base.specimen_info[1],
          specimen_name: "spec2",
          collection_country: "Ghana",
          geo_admin1: "Gaza",
          collection_date: "2019-03",
          project_id: 1,
          specimen_type: "field_sample",
          study_arm: "arm_b",
        },
        {
          ...base.specimen_info[2],
          specimen_name: "neg",
          collection_country: "Ghana",
          collection_date: "2020",
          project_id: 1,
          specimen_type: "negative_control",
          study_arm: "arm_b",
        },
      ],
    };
    const { user } = await open(pmoFile(withFields));

    // Read the plain names Compare offers for shared fields.
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    const compareSelect = await screen.findByRole("combobox", { name: "Group specimens by" });
    await user.click(compareSelect);
    const compareLabels = screen
      .getAllByRole("option")
      .map((option) => (option.textContent ?? "").replace(/\s*\(\d+ of \d+ specimens\)$/, ""));
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: /Specimens with certain values/ }));
    const fieldSelect = screen.getByRole("combobox", { name: "Field" });
    await user.click(fieldSelect);
    const subsetLabels = screen.getAllByRole("option").map((option) => option.textContent ?? "");
    await user.keyboard("{Escape}");

    expect(subsetLabels).toEqual(
      expect.arrayContaining([
        "Country",
        "Administrative area, level 1",
        "Collection year",
        "Collection date",
        "Project",
        "Specimen type",
        "study_arm",
      ]),
    );
    // Every field offered by both Compare and Subset uses the exact same plain label.
    for (const shared of [
      "Country",
      "Administrative area, level 1",
      "Collection year",
      "Project",
    ]) {
      expect(compareLabels).toContain(shared);
      expect(subsetLabels).toContain(shared);
    }

    // Accessible legend and remove button use the plain name too.
    expect(screen.getByRole("group", { name: "Values of Country" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a condition" }));
    expect(
      screen.getByRole("button", { name: "Remove the condition on Country" }),
    ).toBeInTheDocument();
  });

  it("keeps the exact specimens for chosen collection years and previews the right counts", async () => {
    const { user } = await open(pmoFile(EXAMPLE, "study.json.gz"));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: /Specimens with certain values/ }));

    const values = screen.getByRole("group", { name: "Values of Collection year" });
    await user.click(within(values).getByRole("checkbox", { name: /2015/ }));
    await user.click(within(values).getByRole("checkbox", { name: /2019/ }));

    expect(screen.getByText("13 of 50 specimens kept.")).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^The subset will keep 13 of 50 specimens and 13 of 50 library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();
    expect(
      screen.getByText(
        /^It keeps 13 of 50 specimens and 13 of 50 library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(await savedSpecimenNames()).toEqual([
      "example_specimen_01",
      "example_specimen_04",
      "example_specimen_05",
      "example_specimen_09",
      "example_specimen_10",
      "example_specimen_16",
      "example_specimen_22",
      "example_specimen_26",
      "example_specimen_29",
      "example_specimen_33",
      "example_specimen_35",
      "example_specimen_45",
      "example_specimen_50",
    ]);
  });

  it("still keeps specimens by exact collection date", async () => {
    const { user } = await open(pmoFile(EXAMPLE, "study.json.gz"));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: /Specimens with certain values/ }));

    await user.click(screen.getByRole("combobox", { name: "Field" }));
    await user.click(screen.getByRole("option", { name: "Collection date" }));

    const values = screen.getByRole("group", { name: "Values of Collection date" });
    await user.click(within(values).getByRole("checkbox", { name: /2019-06/ }));

    expect(screen.getByText("5 of 50 specimens kept.")).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^The subset will keep 5 of 50 specimens and 5 of 50 library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(await savedSpecimenNames()).toEqual([
      "example_specimen_05",
      "example_specimen_22",
      "example_specimen_29",
      "example_specimen_45",
      "example_specimen_50",
    ]);
  });

  it("subsets by a raw custom collection_year field using its raw values instead of collection_date", async () => {
    const base = richPmo();
    const withRawYear: PortableMicrohaplotypeObject = {
      ...base,
      specimen_info: [
        { ...base.specimen_info[0], specimen_name: "spec1", collection_year: "FY20" },
        { ...base.specimen_info[1], specimen_name: "spec2", collection_year: "FY21" },
        { ...base.specimen_info[2], specimen_name: "neg" },
      ],
    };
    const { user } = await open(pmoFile(withRawYear, "study.json.gz"));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: /Specimens with certain values/ }));

    await user.click(screen.getByRole("combobox", { name: "Field" }));
    await user.click(screen.getByRole("option", { name: "Collection year" }));

    const values = screen.getByRole("group", { name: "Values of Collection year" });
    await user.click(within(values).getByRole("checkbox", { name: /FY20/ }));

    expect(screen.getByText("1 of 3 specimens kept.")).toBeInTheDocument();
    expect(
      await screen.findByText(
        /^The subset will keep 1 of 3 specimens and 1 of 3 library samples, with alleles at \d+ of \d+ targets\.$/,
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect(await savedSpecimenNames()).toEqual(["spec1"]);
  });
});

/** Makes a subset of the first `count` specimens on the Subset tab. */
/** Asks for a subset of the first `count` specimens, on the Subset tab. */
async function askForSubset(user: ReturnType<typeof userEvent.setup>, count: number) {
  await user.click(await screen.findByRole("tab", { name: "Subset" }));
  await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
  const boxes = within(screen.getByRole("group", { name: "Specimens" })).getAllByRole("checkbox");
  // oxlint-disable-next-line no-await-in-loop
  for (const box of boxes.slice(0, count)) await user.click(box);
  await user.click(screen.getByRole("button", { name: "Make the subset" }));
}

async function makeSubset(user: ReturnType<typeof userEvent.setup>, count: number) {
  await askForSubset(user, count);
  await screen.findByText("The subset is ready");
}

/** What Summary, Compare, Tables and Publish each show, in a word or a number. */
async function described(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: "Summary" }));
  await vi.waitFor(() => screen.getByRole("table", { name: "Samples" }));
  const samples =
    within(screen.getByRole("table", { name: "Samples" })).getAllByRole("row").length - 1;
  await user.click(screen.getByRole("tab", { name: "Compare" }));
  await vi.waitFor(() => screen.getByRole("table", { name: "Groups" }));
  const compared = columnOf(screen.getByRole("table", { name: "Groups" }), /^Specimens/)
    .map(Number)
    .reduce((sum, count) => sum + count, 0);
  await user.click(screen.getByRole("tab", { name: "Tables" }));
  await user.click(screen.getByRole("button", { name: "Download Specimens as csv" }));
  await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
  const table = (await savedText()).name;
  vi.mocked(saveFile).mockReset();
  await user.click(screen.getByRole("tab", { name: "Publish to Zenodo" }));
  const region = await screen.findByRole("region", { name: "Publish to Zenodo" });
  await user.click(
    await within(region).findByRole("button", { name: "Deposit in the PMO community" }),
  );
  const dialog = await screen.findByRole("dialog", { name: "Publish to Zenodo" });
  await user.click(within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" }));
  await within(dialog).findByText("Your draft is ready on Zenodo");
  const published = vi.mocked(depositDraft).mock.calls.at(-1)?.[0].fileName;
  await user.keyboard("{Escape}");
  return { samples, compared, table, published };
}

describe("PmoFilePage: original or subset", () => {
  const SWITCH = { name: "Work with" } as const;

  beforeEach(() => {
    installBlobStream();
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({
      ok: true,
      draftUrl: "https://zenodo.org/uploads/1",
    });
  });

  it("has no switch before a subset is made, and every tab uses the whole file", async () => {
    const { user } = await open(pmoFile(ownPmo()));
    await screen.findByText("This file is a valid PMO");
    expect(screen.queryByRole("radiogroup", SWITCH)).not.toBeInTheDocument();
    expect(await described(user)).toEqual({
      samples: EXAMPLE.library_sample_info.length,
      compared: EXAMPLE.specimen_info.length,
      table: "study-specimens.csv",
      published: "study.json",
    });
    expect(screen.queryByRole("radiogroup", SWITCH)).not.toBeInTheDocument();
  });

  it("switches every tab to the subset once it is made, and back together", async () => {
    const { user } = await open(pmoFile(ownPmo()));
    await makeSubset(user, 3);
    const choice = screen.getByRole("radiogroup", SWITCH);
    expect(within(choice).getByRole("radio", { name: "Subset" })).toBeChecked();
    expect(await described(user)).toEqual({
      samples: 3,
      compared: 3,
      table: "study-subset-specimens.csv",
      published: "study-subset.json.gz",
    });

    await user.click(within(choice).getByRole("radio", { name: "Original" }));
    expect(await described(user)).toEqual({
      samples: EXAMPLE.library_sample_info.length,
      compared: EXAMPLE.specimen_info.length,
      table: "study-specimens.csv",
      published: "study.json",
    });
  });

  it("stays on the subset when a new one replaces it", async () => {
    const { user } = await open(pmoFile(ownPmo()));
    await makeSubset(user, 3);
    await user.click(screen.getByRole("radio", { name: "Original" }));
    await makeSubset(user, 2);
    expect(screen.getByRole("radio", { name: "Subset" })).toBeChecked();
  });

  it("keeps the switch on the subset while a new one is being made", async () => {
    const engine = createInThreadEngine();
    const held = new Gate();
    let holding = false;
    const { user } = await openWithEngine(pmoFile(ownPmo()), {
      ...engine,
      workingPmo: async (call) => {
        if (call.request.kind === "subset" && holding) await held.promise;
        return engine.workingPmo(call);
      },
    });
    await makeSubset(user, 3);
    holding = true;
    const boxes = within(screen.getByRole("group", { name: "Specimens" })).getAllByRole("checkbox");
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(3, 4)) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    const choice = screen.getByRole("radiogroup", SWITCH);
    expect(within(choice).getByRole("radio", { name: "Subset" })).toBeChecked();
    await act(async () => held.open());
    expect(await screen.findByText(/^It keeps 4 of \d+ specimens/)).toBeInTheDocument();
    expect(within(choice).getByRole("radio", { name: "Subset" })).toBeChecked();
  });

  it("changes from the keyboard", async () => {
    const { user } = await open(pmoFile(ownPmo()));
    await makeSubset(user, 3);
    const choice = screen.getByRole("radiogroup", SWITCH);
    within(choice).getByRole("radio", { name: "Subset" }).focus();
    // Held down, as Radix checks the radio it moves to only while an arrow key is down.
    await user.keyboard("{ArrowLeft>}");
    const original = within(choice).getByRole("radio", { name: "Original" });
    await vi.waitFor(() => expect(original).toBeChecked());
    await user.keyboard("{/ArrowLeft}");
    expect(original).toHaveFocus();
  });

  it("hides the switch and goes back to the whole file when another file is opened over it", async () => {
    const { user } = await open(pmoFile(ownPmo()));
    await makeSubset(user, 3);
    expect(screen.getByRole("radiogroup", SWITCH)).toBeInTheDocument();
    // Straight over the first, without closing it.
    await user.upload(screen.getByLabelText("Choose pmo file"), pmoFile(ownPmo(), "other.json"));
    await screen.findByText("other.json");
    await screen.findByRole("tab", { name: "Tables" });
    expect(screen.queryByRole("radiogroup", SWITCH)).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("button", { name: "Download Specimens as csv" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    expect((await savedText()).name).toBe("other-specimens.csv");
  });
});

describe("PmoFilePage: when a subset cannot be made", () => {
  it("says the subset could not be made, without the engine's own words", async () => {
    let instead: Instead = null;
    const { engine } = watchedEngine((kind) => (kind === "subset" ? instead : null));
    const { user } = await openWithEngine(pmoFile(ownPmo()), engine);
    await screen.findByText("This file is a valid PMO");
    instead = { kind: "failed", message: "RangeError: Invalid array length" };
    await askForSubset(user, 2);
    expect(await screen.findByText("The subset could not be made")).toBeInTheDocument();
    expect(
      screen.getByText("Make the subset again. If it fails again, open the file again."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Invalid array length/)).not.toBeInTheDocument();
  });

  it("says no subset has been made when the worker made none", async () => {
    const { engine } = watchedEngine((kind) => (kind === "subset" ? { kind: "no-subset" } : null));
    const { user } = await openWithEngine(pmoFile(ownPmo()), engine);
    await askForSubset(user, 2);
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });
});

describe("PmoFilePage: when the subset cannot be counted", () => {
  it.each([
    {
      answer: { kind: "failed", message: "out of memory" },
      title: "The subset could not be counted",
    },
    { answer: { kind: "not-open" }, title: "No file is open" },
  ] satisfies readonly { readonly answer: Instead; readonly title: string }[])(
    "says $title",
    async ({ answer, title }) => {
      const { engine } = watchedEngine((kind) => (kind === "preview" ? answer : null));
      const { user } = await openWithEngine(pmoFile(ownPmo()), engine);
      await user.click(await screen.findByRole("tab", { name: "Subset" }));
      await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
      const boxes = within(screen.getByRole("group", { name: "Specimens" })).getAllByRole(
        "checkbox",
      );
      // oxlint-disable-next-line no-await-in-loop
      for (const box of boxes.slice(0, 2)) await user.click(box);
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByText(/out of memory/)).not.toBeInTheDocument();
    },
  );
});

describe("PmoFilePage: when the subset cannot be downloaded", () => {
  it.each([
    { answer: { kind: "failed", message: "out of memory" }, title: "The file could not be made" },
    { answer: { kind: "no-subset" }, title: "No subset has been made yet" },
    { answer: { kind: "not-open" }, title: "No file is open" },
  ] satisfies readonly { readonly answer: Instead; readonly title: string }[])(
    "says $title",
    async ({ answer, title }) => {
      let instead: Instead = null;
      const { engine } = watchedEngine((kind) => (kind === "file" ? instead : null));
      const { user } = await openWithEngine(pmoFile(ownPmo()), engine);
      await makeSubset(user, 2);
      instead = answer;
      await user.click(screen.getByRole("button", { name: "Download as .json" }));
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByText(/out of memory/)).not.toBeInTheDocument();
      expect(saveFile).not.toHaveBeenCalled();
    },
  );
});

describe("PmoFilePage: when the subset cannot be published", () => {
  it.each([
    {
      answer: { kind: "failed", message: "out of memory" },
      title: "The subset could not be prepared",
    },
    { answer: { kind: "no-subset" }, title: "No subset has been made yet" },
    { answer: { kind: "not-open" }, title: "No file is open" },
  ] satisfies readonly { readonly answer: Instead; readonly title: string }[])(
    "says $title",
    async ({ answer, title }) => {
      installBlobStream();
      let instead: Instead = null;
      const { engine } = watchedEngine((kind) => (kind === "file" ? instead : null));
      const { user } = await openWithEngine(pmoFile(ownPmo()), engine);
      await makeSubset(user, 2);
      instead = answer;
      await user.click(screen.getByRole("button", { name: "Publish the subset" }));
      expect(await screen.findByText(title)).toBeInTheDocument();
      expect(screen.queryByText(/out of memory/)).not.toBeInTheDocument();
    },
  );
});

describe("PmoFilePage: publishing", () => {
  it("deposits the chosen file itself", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({
      ok: true,
      draftUrl: "https://zenodo.org/uploads/1",
    });
    const file = pmoFile(ownPmo(), "lab-2025.pmo.json");
    const { user } = await open(file);
    await user.click(await screen.findByRole("tab", { name: "Publish to Zenodo" }));
    const publish = await screen.findByRole("region", { name: "Publish to Zenodo" });
    await user.click(within(publish).getByRole("button", { name: "Deposit in the PMO community" }));
    const dialog = await screen.findByRole("dialog", { name: "Publish to Zenodo" });
    await user.click(within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" }));
    expect(await within(dialog).findByText("Your draft is ready on Zenodo")).toBeInTheDocument();
    expect(depositDraft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ file, fileName: "lab-2025.pmo.json", community: "pmocommunity" }),
    );
  });

  it("offers to publish the subset instead, once one is made, and deposits its file", async () => {
    installBlobStream();
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({
      ok: true,
      draftUrl: "https://zenodo.org/uploads/1",
    });
    const { user } = await open(pmoFile(ownPmo()));
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.click(screen.getByRole("radio", { name: "Specimens I tick" }));
    const specimens = screen.getByRole("group", { name: "Specimens" });
    const boxes = within(specimens).getAllByRole("checkbox");
    // One click after another, as a person would tick them.
    // oxlint-disable-next-line no-await-in-loop
    for (const box of boxes.slice(0, 2)) await user.click(box);
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");
    await user.click(screen.getByRole("button", { name: "Publish the subset" }));
    expect(await screen.findByRole("radio", { name: "Subset" })).toBeChecked();
    const publish = await screen.findByRole("region", { name: "Publish to Zenodo" });
    await user.click(
      await within(publish).findByRole("button", { name: "Deposit in the PMO community" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Publish to Zenodo" });
    await user.click(within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" }));
    expect(await within(dialog).findByText("Your draft is ready on Zenodo")).toBeInTheDocument();

    const deposited = vi.mocked(depositDraft).mock.calls.at(-1)?.[0];
    if (deposited === undefined) throw new Error("nothing deposited");
    expect(deposited.fileName).toBe("study-subset.json.gz");
    const { pmo } = await readPmoFile(deposited.file);
    expect(pmo?.specimen_info).toHaveLength(2);
  });

  it("does not offer to publish the example data", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Publish to Zenodo" }));
    expect(
      await screen.findByText(
        /This file is built from the example data, so it cannot be published/,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Publish to Zenodo" })).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("leaves publishing out when this copy is not set up for it", async () => {
    await open(pmoFile(ownPmo()), null);
    await screen.findByText("This file is a valid PMO");
    expect(screen.queryByRole("tab", { name: "Publish to Zenodo" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Subset" })).toBeInTheDocument();
  });
});

describe("PmoFilePage: summary", () => {
  it("sums up the file: headline numbers, samples, targets and a target's alleles", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    expect(await screen.findByText("Reads by sample and target")).toBeInTheDocument();
    expect(screen.getByText("Median targets per sample")).toBeInTheDocument();

    const samples = screen.getByRole("table", { name: "Samples" });
    expect(within(samples).getAllByRole("row").length).toBe(EXAMPLE.library_sample_info.length + 1);

    const targets = screen.getByRole("table", { name: "Targets" });
    const [, firstRow] = within(targets).getAllByRole("row");
    if (firstRow === undefined) throw new Error("no target rows");
    const name = within(firstRow).getAllByRole("cell")[0]?.textContent ?? "";
    expect(
      screen.getByText(new RegExp(`^Microhaplotypes at ${name}, seen in \\d+ samples?$`)),
    ).toBeInTheDocument();
  });

  it("jumps to a section, listing only the sections the file has", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    const jumps = await screen.findByRole("navigation", { name: "Sections" });
    expect(
      within(jumps)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Reads grid", "Samples", "Targets and alleles"]);
    await user.click(within(jumps).getByRole("button", { name: "Targets and alleles" }));
    expect(screen.getByRole("heading", { name: "Targets" })).toHaveFocus();
  });

  it("recounts with a read threshold, kept when switching tabs", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    const samples = await screen.findByRole("table", { name: "Samples" });
    const readsBefore = within(samples).getAllByRole("row").length;
    await user.type(screen.getByLabelText("Minimum reads per microhaplotype"), "100000");
    // Nothing reaches the threshold: no target has data, but every sample stays listed.
    await vi.waitFor(
      () =>
        expect(
          within(screen.getByRole("table", { name: "Targets" })).getAllByRole("row"),
        ).toHaveLength(1),
      { timeout: 3000 },
    );
    expect(within(screen.getByRole("table", { name: "Samples" })).getAllByRole("row")).toHaveLength(
      readsBefore,
    );

    // The threshold is the session's, so it survives a visit to another tab.
    await user.click(screen.getByRole("tab", { name: "Tables" }));
    await user.click(screen.getByRole("tab", { name: "Summary" }));
    expect(await screen.findByLabelText("Minimum reads per microhaplotype")).toHaveValue("100000");
  });

  it("sorts a table by the chosen column", async () => {
    const { user } = await open(pmoFile(EXAMPLE));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    const samples = await screen.findByRole("table", { name: "Samples" });
    const header = within(samples).getByRole("columnheader", { name: /Reads/ });
    // Fewest reads first, so failing samples are at the top.
    expect(header).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(samples).getByRole("button", { name: "Sort by Reads" }));
    expect(header).toHaveAttribute("aria-sort", "descending");
  });
});

describe("PmoFilePage: optional details", () => {
  it("shows controls, plates, stages and optional columns only for data the file has", async () => {
    const { user } = await open(pmoFile(richPmo()));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    await screen.findByText("Reads by sample and target");
    expect(screen.getByText("Check the controls")).toBeInTheDocument();
    expect(screen.getByText("Negative control S3 has 3 reads.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plates" })).toBeInTheDocument();
    expect(
      screen.getByText("Plate positions are given for 2 of 3 library samples."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Read counts by stage are given for 1 of 3 library samples."),
    ).toBeInTheDocument();
    // Two densities are too few to plot.
    expect(
      screen.queryByRole("heading", { name: "Parasite density and targets with data" }),
    ).toBeNull();
    const samples = screen.getByRole("table", { name: "Samples" });
    for (const column of ["Control", "Plate well", "Parasites per µL"]) {
      expect(
        within(samples).getByRole("columnheader", { name: new RegExp(column) }),
      ).toBeInTheDocument();
    }
    // Only pool1 has targets with data, so there is nothing to group until
    // the targets without data are shown too.
    expect(screen.queryByRole("switch", { name: "Group targets by reaction" })).toBeNull();
    await user.click(screen.getByRole("switch", { name: "Show targets with no data" }));
    expect(screen.getByRole("switch", { name: "Group targets by reaction" })).toBeInTheDocument();
  });

  it("leaves out every optional view when the file has none of their data", async () => {
    const plain = buildExamplePmo();
    const bare = {
      ...plain,
      library_sample_info: plain.library_sample_info.map(
        ({ library_prep_plate_info: _plate, ...rest }) => rest,
      ),
    };
    const { read_counts_by_stage: _counts, ...withoutCounts } = bare;
    const { user } = await open(pmoFile(withoutCounts));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    await screen.findByText("Reads by sample and target");
    expect(screen.queryByRole("heading", { name: "Plates" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Reads at each pipeline stage" })).toBeNull();
    expect(screen.queryByText("Check the controls")).toBeNull();
    const samples = screen.getByRole("table", { name: "Samples" });
    expect(within(samples).queryByRole("columnheader", { name: /Plate well/ })).toBeNull();
  });

  it("compares groups, keeping specimens without a value as Not recorded", async () => {
    const { user } = await open(pmoFile(richPmo()));
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    const field = await screen.findByRole("combobox", { name: "Group specimens by" });
    await user.click(field);
    await user.click(await screen.findByRole("option", { name: /Administrative area, level 1/ }));
    expect(
      await screen.findByText(
        "2 of 3 specimens have a value for Administrative area, level 1. The others are grouped as Not recorded.",
      ),
    ).toBeInTheDocument();
    const groups = await screen.findByRole("table", { name: "Groups" });
    expect(within(groups).getByText("Not recorded")).toBeInTheDocument();
    expect(within(groups).getByText("Gaza")).toBeInTheDocument();
  });

  it("says when there is nothing to group by", async () => {
    const plain = buildExamplePmo();
    const ungrouped = {
      ...plain,
      specimen_info: plain.specimen_info.map((specimen) => ({
        specimen_name: specimen.specimen_name,
      })),
    };
    const { user } = await open(pmoFile(ungrouped));
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    expect(
      await screen.findByText("There is nothing to group the specimens by"),
    ).toBeInTheDocument();
  });
});

/**
 * An in-thread engine that notes the kind of each working PMO request, and
 * fails comparisons when asked to.
 */
/** What a watched engine gives instead of answering: an answer, an error to throw, or `null` to answer. */
type Instead = WorkingPmoResult<never> | Error | null;

/**
 * An engine in this thread that records the kind of each working PMO
 * request, and gives what `instead` says in place of answering it.
 */
function watchedEngine(instead: (kind: WorkingPmoKind) => Instead = () => null): {
  readonly engine: Engine;
  readonly kinds: string[];
} {
  const engine = createInThreadEngine();
  const kinds: string[] = [];
  return {
    kinds,
    engine: {
      ...engine,
      workingPmo: (call) => {
        kinds.push(call.request.kind);
        const given = instead(call.request.kind);
        if (given === null) return engine.workingPmo(call);
        return given instanceof Error ? Promise.reject(given) : Promise.resolve(given);
      },
    },
  };
}

async function openWithEngine(file: File, engine: Engine) {
  const rendered = await renderPage(ZENODO, createTestStore({ engine }));
  await rendered.user.upload(screen.getByLabelText("Choose pmo file"), file);
  return rendered;
}

/** Whether a column of figures is all zero. */
function allZero(figures: readonly string[]): boolean {
  return figures.length > 0 && figures.every((figure) => figure === "0");
}

/** The figures in a table's column, by its header. */
function columnOf(table: HTMLElement, header: RegExp): string[] {
  const headers = within(table).getAllByRole("columnheader");
  const index = headers.findIndex((cell) => header.test(cell.textContent ?? ""));
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[index]?.textContent ?? "");
}

describe("PmoFilePage: compare", () => {
  it("lists the fields to compare by without summing up the whole file", async () => {
    const { engine, kinds } = watchedEngine();
    const { user } = await openWithEngine(pmoFile(richPmo()), engine);
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    await screen.findByRole("table", { name: "Groups" });
    expect(kinds).toContain("groupFields");
    expect(kinds).not.toContain("summary");
  });

  it("uses the minimum reads set on Summary, and Summary uses the one set here", async () => {
    const { user } = await open(pmoFile(richPmo()));
    await user.click(await screen.findByRole("tab", { name: "Summary" }));
    await user.type(await screen.findByLabelText("Minimum reads per microhaplotype"), "1000000");
    await user.click(screen.getByRole("tab", { name: "Compare" }));
    expect(await screen.findByLabelText("Minimum reads per microhaplotype")).toHaveValue("1000000");
    await vi.waitFor(
      () =>
        expect(
          allZero(columnOf(screen.getByRole("table", { name: "Groups" }), /Samples with data/)),
        ).toBe(true),
      { timeout: 3000 },
    );

    await user.clear(screen.getByLabelText("Minimum reads per microhaplotype"));
    await vi.waitFor(
      () =>
        expect(
          allZero(columnOf(screen.getByRole("table", { name: "Groups" }), /Samples with data/)),
        ).toBe(false),
      { timeout: 3000 },
    );
    await user.click(screen.getByRole("tab", { name: "Summary" }));
    expect(await screen.findByLabelText("Minimum reads per microhaplotype")).toHaveValue("");
  });

  it("says when the comparison could not be made", async () => {
    const { engine } = watchedEngine((kind) =>
      kind === "groups" ? new Error("out of memory") : null,
    );
    const { user } = await openWithEngine(pmoFile(richPmo()), engine);
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    expect(await screen.findByText("The comparison could not be made")).toBeInTheDocument();
  });

  it("says when no file is open", async () => {
    await renderWithStore(
      <CompareTab source="original" minReads={null} onMinReadsChange={() => undefined} />,
    );
    expect(await screen.findByText("No file is open")).toBeInTheDocument();
  });
});

describe("PmoFilePage: worker restarts", () => {
  it("asks to open the file again when it cannot be opened in the new worker", async () => {
    const engine = createInThreadEngine();
    let stopped = false;
    const stopping: Engine = {
      ...engine,
      workingPmo: (call) =>
        stopped
          ? Promise.reject(new EngineStoppedError("The background worker stopped."))
          : engine.workingPmo(call),
    };
    const { user } = await openWithEngine(pmoFile(richPmo()), stopping);
    const summaryTab = await screen.findByRole("tab", { name: "Summary" });
    stopped = true;
    await user.click(summaryTab);
    expect(
      await screen.findByText(
        "The file was closed, probably because the browser ran out of memory. Open the file again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Summary" })).not.toBeInTheDocument();
  });
});
