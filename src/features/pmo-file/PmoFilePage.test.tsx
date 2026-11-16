import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";

import { buildExamplePmo } from "@/domain/build/testing";
import { richPmo } from "@/domain/tools/testing";
import { readZip } from "@/domain/tools/zipTesting";
import { saveFile } from "@/features/review/saveFile";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { signIn } from "@/features/review/zenodoAuth";
import { depositDraft } from "@/features/review/zenodoDeposit";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";
import { installBlobStream } from "@/test/blobStream";
import type { Engine } from "@/worker";
import { createInThreadEngine } from "@/worker/engine";

import { OPEN_BUILT_PATH, PmoFilePage, PmoFileRoute, PMO_TABS, type PmoTab } from "./PmoFilePage";
import { TablesPanel } from "./TablesPanel";
import { CompareTab } from "./summary/CompareTab";
import { resetWorkspace } from "./workspace";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));
vi.mock("@/features/review/zenodoAuth", () => ({ signIn: vi.fn<typeof signIn>() }));
vi.mock("@/features/review/zenodoDeposit", () => ({
  depositDraft: vi.fn<typeof depositDraft>(),
}));

const ZENODO: ZenodoConfig = {
  community: "plasmogenepi",
  communityName: "PlasmoGenEpi",
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

async function savedText(): Promise<{ readonly name: string; readonly text: string }> {
  const call = vi.mocked(saveFile).mock.calls.at(-1);
  if (call === undefined) throw new Error("nothing saved");
  const [blob, name] = call;
  return { name, text: await blob.text() };
}

beforeEach(() => {
  resetWorkspace();
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
    await renderWithStore(
      <TablesPanel
        tables={listed}
        subsetTables={listed}
        source="subset"
        onSourceChange={() => undefined}
      />,
      { store },
    );
    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Download all tables (.zip)" }));
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();
    expect(screen.queryByText(/could not be made/)).not.toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();
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
    expect(await screen.findByRole("radio", { name: "The subset" })).toBeInTheDocument();
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
    expect(await screen.findByRole("radio", { name: "The subset" })).toBeChecked();
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
    await user.click(
      within(publish).getByRole("button", { name: "Deposit in the PlasmoGenEpi community" }),
    );
    const dialog = await screen.findByRole("dialog", { name: "Publish to Zenodo" });
    await user.click(within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" }));
    expect(await within(dialog).findByText("Your draft is ready on Zenodo")).toBeInTheDocument();
    expect(depositDraft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ file, fileName: "lab-2025.pmo.json", community: "plasmogenepi" }),
    );
  });

  it("offers to publish the subset instead, once one is made", async () => {
    const { user, store } = await open(pmoFile(ownPmo()));
    // The test DOM's Blob cannot stream, which gzip needs; browsers can.
    const workingPmoFile = vi.spyOn(store.getState().actions, "workingPmoFile").mockResolvedValue({
      blob: new Blob(["{}"]),
      fileName: "study-subset.json.gz",
    });
    await user.click(await screen.findByRole("tab", { name: "Subset" }));
    await user.type(screen.getByLabelText(/Minimum reads per microhaplotype/), "50");
    await user.click(screen.getByRole("button", { name: "Make the subset" }));
    await screen.findByText("The subset is ready");
    await user.click(screen.getByRole("button", { name: "Publish the subset" }));
    expect(await screen.findByRole("radio", { name: "The subset" })).toBeChecked();
    const publish = await screen.findByRole("region", { name: "Publish to Zenodo" });
    expect(
      within(publish).getByRole("button", { name: "Deposit in the PlasmoGenEpi community" }),
    ).toBeEnabled();
    expect(workingPmoFile).toHaveBeenCalledWith({ gzip: true });
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

    // The threshold is the workspace's, so it survives a visit to another tab.
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
function watchedEngine(options: { readonly failGroups?: boolean } = {}): {
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
        return options.failGroups === true && call.request.kind === "groups"
          ? Promise.reject(new Error("out of memory"))
          : engine.workingPmo(call);
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
    const { engine } = watchedEngine({ failGroups: true });
    const { user } = await openWithEngine(pmoFile(richPmo()), engine);
    await user.click(await screen.findByRole("tab", { name: "Compare" }));
    expect(await screen.findByText("The comparison could not be made")).toBeInTheDocument();
  });

  it("says when no file is open", async () => {
    await renderWithStore(
      <CompareTab
        hasSubset={false}
        source="original"
        onSourceChange={() => undefined}
        minReads={null}
        onMinReadsChange={() => undefined}
      />,
    );
    expect(await screen.findByText("No file is open")).toBeInTheDocument();
  });
});
