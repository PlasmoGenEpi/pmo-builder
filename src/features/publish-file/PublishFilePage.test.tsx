import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo, type PortableMicrohaplotypeObject } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";
import type { ZenodoConfig } from "@/features/review/zenodo";
import { signIn } from "@/features/review/zenodoAuth";
import { depositDraft } from "@/features/review/zenodoDeposit";
import { createTestStore, renderWithStore } from "@/features/shared/testing";

import { PublishFilePage } from "./PublishFilePage";

vi.mock("@/features/review/zenodoAuth", () => ({ signIn: vi.fn<typeof signIn>() }));
vi.mock("@/features/review/zenodoDeposit", () => ({
  depositDraft: vi.fn<typeof depositDraft>(),
}));

const ZENODO: ZenodoConfig = {
  community: "plasmogenepi",
  communityName: "PlasmoGenEpi",
  clientId: "client-1",
};

/** The example PMO with its own sample names, so it does not count as the example. */
function ownPmo(): PortableMicrohaplotypeObject {
  const pmo = buildExamplePmo();
  return {
    ...pmo,
    library_sample_info: pmo.library_sample_info.map((sample, index) =>
      Object.assign({}, sample, { library_sample_name: `lab_sample_${index + 1}` }),
    ),
  };
}

function pmoFile(data: unknown, name = "study.pmo.json"): File {
  return new File([typeof data === "string" ? data : stringifyPmo(data)], name);
}

async function choose(file: File, zenodo: ZenodoConfig | null = ZENODO) {
  const store = createTestStore();
  const user = userEvent.setup();
  await renderWithStore(<PublishFilePage zenodo={zenodo} />, { store });
  await user.upload(screen.getByLabelText("Choose pmo file"), file);
  return { store, user };
}

beforeEach(() => {
  vi.mocked(signIn).mockReset();
  vi.mocked(depositDraft).mockReset();
});

describe("PublishFilePage", () => {
  it("checks a valid file, shows what it holds, and offers the deposit", async () => {
    const { store } = await choose(pmoFile(ownPmo()));
    expect(await screen.findByText("This file is a valid PMO")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "What is in the PMO" })).toBeInTheDocument();
    const publish = screen.getByRole("region", { name: "Publish to Zenodo" });
    expect(
      within(publish).getByRole("button", { name: "Deposit in the PlasmoGenEpi community" }),
    ).toBeEnabled();
    // The user's draft is left alone.
    expect(store.getState().draft.microhaplotypes.table).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
  });

  it("deposits the chosen file itself", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({
      ok: true,
      draftUrl: "https://zenodo.org/uploads/1",
    });
    const file = pmoFile(ownPmo(), "lab-2025.pmo.json");
    const { user } = await choose(file);
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

  it("does not offer to publish the example data", async () => {
    await choose(pmoFile(buildExamplePmo()));
    expect(
      await screen.findByText(
        /This file is built from the example data, so it cannot be published/,
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "Publish to Zenodo" })).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  it("refuses a file in another PMO version", async () => {
    const pmo = ownPmo();
    await choose(
      pmoFile(JSON.stringify({ ...pmo, pmo_header: { ...pmo.pmo_header, pmo_version: "1.0.0" } })),
    );
    expect(
      await screen.findByText(/This file is in PMO version 1\.0\.0\. Only version 1\.1\.0 files/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Publish to Zenodo" })).not.toBeInTheDocument();
  });

  it("lists what does not match the PMO format", async () => {
    const pmo = ownPmo();
    const broken = {
      ...pmo,
      specimen_info: pmo.specimen_info.map(({ specimen_name: _name, ...rest }) => rest),
    };
    await choose(pmoFile(JSON.stringify(broken)));
    const alert = await screen.findByText("This file does not match the PMO format");
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/specimen_name.*\(and 49 more like it\)/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Build a PMO" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("region", { name: "Publish to Zenodo" })).not.toBeInTheDocument();
  });

  it("says when a file is not a PMO at all", async () => {
    await choose(pmoFile("sample,reads\ns1,10\n", "table.json"));
    expect(await screen.findByText(/This is not a PMO file/)).toBeInTheDocument();
  });

  it("says when this copy is not set up for publishing", async () => {
    const store = createTestStore();
    await renderWithStore(<PublishFilePage zenodo={null} />, { store });
    expect(
      screen.getByText("This copy of PMO Builder is not set up for publishing"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Choose pmo file")).not.toBeInTheDocument();
  });

  it("lets the user choose another file", async () => {
    const { user } = await choose(pmoFile("not json", "first.json"));
    await screen.findByText(/This is not a PMO file/);
    await user.click(screen.getByRole("button", { name: "Remove pmo file" }));
    await act(() => Promise.resolve());
    expect(screen.queryByText(/This is not a PMO file/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Choose pmo file")).toBeInTheDocument();
  });
});
