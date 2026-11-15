import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Switch } from "wouter";

import { buildExamplePmo } from "@/domain/build/testing";
import { saveFile } from "@/features/review/saveFile";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { signIn } from "@/features/review/zenodoAuth";
import { depositDraft } from "@/features/review/zenodoDeposit";
import { createTestStore, renderWithStore } from "@/features/shared/testing";

import { PmoFilePage, PMO_TABS, type PmoTab } from "./PmoFilePage";
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
async function renderPage(zenodo: ZenodoConfig | null = ZENODO) {
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
    { store: createTestStore(), path: "/pmo" },
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
    await renderPage();
    expect(screen.getByText("This file is a valid PMO")).toBeInTheDocument();
    expect(screen.getByText("study.json")).toBeInTheDocument();
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
    await user.click(make);
    expect(await screen.findByText("The subset is ready")).toBeInTheDocument();
    expect(
      screen.getByText(/In the subset: specimens 3, library samples 3, targets with alleles \d+\./),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Download as .json" }));
    await vi.waitFor(() => expect(saveFile).toHaveBeenCalled());
    const { name, text } = await savedText();
    expect(name).toBe("study-subset.json");
    const subset: unknown = JSON.parse(text);
    expect(subset).toMatchObject({ specimen_info: [{}, {}, {}] });
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
