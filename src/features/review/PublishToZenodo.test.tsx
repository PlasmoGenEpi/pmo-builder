import { act, screen, within } from "@testing-library/react";
import userEvent, { type UserEvent } from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicationSummary } from "@/domain/build";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import type { AppActions, AppStore } from "@/state";

import { ReviewStep } from "./ReviewStep";
import { saveFile } from "./saveFile";
import type { ZenodoConfig } from "./zenodo";
import { signIn } from "./zenodoAuth";
import { depositDraft } from "./zenodoDeposit";

vi.mock("./saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));
vi.mock("./zenodoAuth", () => ({ signIn: vi.fn<typeof signIn>() }));
vi.mock("./zenodoDeposit", () => ({ depositDraft: vi.fn<typeof depositDraft>() }));

const MANUAL: ZenodoConfig = {
  community: "plasmogenepi",
  communityName: "PlasmoGenEpi",
  clientId: null,
};

const DIRECT: ZenodoConfig = { ...MANUAL, clientId: "client-1" };
const DRAFT_URL = "https://zenodo.org/uploads/24237640";

const GZIP = { blob: new Blob(["gz"]), fileName: "Mad4hatter.pmo.json.gz" };

function storeWithStubs() {
  const store = createTestStore();
  const real = store.getState().actions;
  const downloadPmo = vi.fn<AppActions["downloadPmo"]>(() => Promise.resolve(GZIP));
  const pmoFileSize = vi.fn<AppActions["pmoFileSize"]>(() =>
    Promise.resolve({ fileName: GZIP.fileName, size: GZIP.blob.size }),
  );
  store.setState({ actions: { ...real, downloadPmo, pmoFileSize } });
  return { store, downloadPmo };
}

async function loadExample(store: AppStore): Promise<void> {
  await act(async () => {
    const result = await store.getState().actions.loadExample();
    if (!result.ok) throw new Error(result.reason);
    await store.getState().actions.flush();
  });
}

/** Replaces parts of the whole-draft result of the latest build. */
function setOverall(
  store: AppStore,
  change: { readonly pmo?: "valid" | "invalid"; readonly publication?: PublicationSummary },
): void {
  const view = store.getState().build.view;
  if (view === null) throw new Error("no build");
  act(() =>
    store.setState({
      build: { phase: "idle", view: { ...view, overall: { ...view.overall, ...change } } },
    }),
  );
}

const PUBLICATION: PublicationSummary = {
  personalFields: [
    { field: "lat_lon", specimens: 49 },
    { field: "host_age", specimens: 1 },
  ],
  projects: [{ name: "MOZ2021", description: "Routine surveillance", accession: null }],
  panels: ["Mad4hatter"],
  countries: ["Mozambique"],
  collectionYears: { first: 2021, last: 2021 },
  exampleData: false,
};

/** The invitation under the download buttons. */
function invitation() {
  return screen.getByRole("region", { name: "Publish to Zenodo" });
}

function queryInvitation() {
  return screen.queryByRole("region", { name: "Publish to Zenodo" });
}

/** Opens the dialog from the invitation's button and returns it. */
async function openDialog(user: UserEvent, zenodo: ZenodoConfig): Promise<HTMLElement> {
  const name =
    zenodo.clientId === null ? "Publish to Zenodo" : "Deposit in the PlasmoGenEpi community";
  await user.click(within(invitation()).getByRole("button", { name }));
  return screen.findByRole("dialog", { name: "Publish to Zenodo" });
}

/** Marks the loaded tables as a user's own, so the PMO can be published. */
function treatAsOwnData(store: AppStore): void {
  const publication = store.getState().build.view?.overall.publication;
  if (publication === null || publication === undefined) throw new Error("no PMO");
  setOverall(store, { publication: { ...publication, exampleData: false } });
}

/**
 * Renders the review step with the example tables loaded, standing in for a
 * user's own data unless `example` is set.
 */
async function renderReview(zenodo: ZenodoConfig | null, options: { example?: boolean } = {}) {
  const stubs = storeWithStubs();
  const user = userEvent.setup();
  await renderWithStore(<ReviewStep zenodo={zenodo} />, { store: stubs.store });
  await loadExample(stubs.store);
  if (options.example !== true) treatAsOwnData(stubs.store);
  return { ...stubs, user };
}

beforeEach(() => {
  vi.mocked(saveFile).mockClear();
  vi.mocked(signIn).mockReset();
  vi.mocked(depositDraft).mockReset();
});

describe("Publish to Zenodo", () => {
  it("is left out when no community is set", async () => {
    const stubs = storeWithStubs();
    await renderWithStore(<ReviewStep />, { store: stubs.store });
    await loadExample(stubs.store);
    expect(stubs.store.getState().build.view?.overall.pmo).toBe("valid");
    expect(queryInvitation()).not.toBeInTheDocument();
  });

  it("sits with the download buttons once the PMO is valid", async () => {
    const stubs = storeWithStubs();
    await renderWithStore(<ReviewStep zenodo={MANUAL} />, { store: stubs.store });
    expect(queryInvitation()).not.toBeInTheDocument();
    await loadExample(stubs.store);
    expect(stubs.store.getState().build.view?.overall.publication?.panels).toEqual(["Mad4hatter"]);
    treatAsOwnData(stubs.store);
    const verdict = screen.getByRole("region", { name: /^ready/i });
    expect(within(verdict).getByRole("button", { name: "Download PMO" })).toBeInTheDocument();
    expect(within(verdict).getByRole("region", { name: "Publish to Zenodo" })).toBeInTheDocument();
    expect(
      within(invitation()).getByRole("link", { name: /PlasmoGenEpi community/ }),
    ).toHaveAttribute("href", "https://zenodo.org/communities/plasmogenepi/");
  });

  it("does not offer to publish the example data", async () => {
    const { store } = await renderReview(DIRECT, { example: true });
    expect(store.getState().build.view?.overall.publication?.exampleData).toBe(true);
    expect(
      within(invitation()).getByText(/built from the example data, so it cannot be published/),
    ).toBeInTheDocument();
    expect(within(invitation()).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(signIn).not.toHaveBeenCalled();
    expect(depositDraft).not.toHaveBeenCalled();

    // The same tables, once they count as the user's own, can be published.
    treatAsOwnData(store);
    expect(
      within(invitation()).getByRole("button", { name: "Deposit in the PlasmoGenEpi community" }),
    ).toBeEnabled();
  });

  it("does not offer the steps for uploading the example data by hand either", async () => {
    await renderReview(MANUAL, { example: true });
    expect(within(invitation()).queryByRole("button")).not.toBeInTheDocument();
  });

  it("is left out when the PMO does not match the format", async () => {
    const { store } = await renderReview(MANUAL);
    setOverall(store, { pmo: "invalid" });
    expect(queryInvitation()).not.toBeInTheDocument();
  });

  it("links to the community's upload page", async () => {
    const { user } = await renderReview(MANUAL);
    const dialog = await openDialog(user, MANUAL);
    const upload = within(dialog).getByRole("link", { name: /open the zenodo upload page/i });
    expect(upload).toHaveAttribute("href", "https://zenodo.org/uploads/new?community=plasmogenepi");
    expect(upload).toHaveAttribute("target", "_blank");
    expect(upload).toHaveAttribute("rel", "noreferrer noopener");
    expect(within(dialog).getByText(/sends nothing to Zenodo: you upload/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /deposit/i })).not.toBeInTheDocument();
  });

  it("lists the personal details the PMO holds and points to the Specimens step", async () => {
    const { store, user } = await renderReview(MANUAL);
    setOverall(store, { publication: PUBLICATION });
    const dialog = await openDialog(user, MANUAL);
    expect(
      within(dialog).getByText("This PMO holds details about the people sampled"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Coordinates, in 49 specimens")).toBeInTheDocument();
    expect(within(dialog).getByText("Age, in 1 specimen")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Go to Specimens" })).toBeInTheDocument();
  });

  it("says so when no personal details are found", async () => {
    const { store, user } = await renderReview(MANUAL);
    setOverall(store, { publication: { ...PUBLICATION, personalFields: [] } });
    const dialog = await openDialog(user, MANUAL);
    expect(within(dialog).getByText("No personal details found")).toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Go to Specimens" })).not.toBeInTheDocument();
  });

  it("copies the suggested title and the collection keyword", async () => {
    const { store, user } = await renderReview(MANUAL);
    setOverall(store, { publication: PUBLICATION });
    const dialog = await openDialog(user, MANUAL);
    await user.click(within(dialog).getByRole("button", { name: "Copy title" }));
    expect(await navigator.clipboard.readText()).toBe("MOZ2021: microhaplotype data in PMO format");
    expect(within(dialog).getByText("Copied")).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Copy keyword Portable Microhaplotype Object" }),
    );
    expect(await navigator.clipboard.readText()).toBe("Portable Microhaplotype Object");
  });

  it("downloads the gzipped PMO from its own button", async () => {
    const { downloadPmo, user } = await renderReview(MANUAL);
    const dialog = await openDialog(user, MANUAL);
    await user.click(within(dialog).getByRole("button", { name: "Download PMO for Zenodo" }));
    expect(downloadPmo).toHaveBeenCalledExactlyOnceWith({ gzip: true });
    expect(saveFile).toHaveBeenCalledExactlyOnceWith(GZIP.blob, GZIP.fileName);
  });
});

function depositButton(dialog: HTMLElement) {
  return within(dialog).getByRole("button", { name: "Sign in to Zenodo and deposit" });
}

describe("Deposit on Zenodo", () => {
  it("contacts nothing when the dialog is opened, only when the deposit is chosen", async () => {
    const { downloadPmo, user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    expect(depositButton(dialog)).toBeEnabled();
    expect(signIn).not.toHaveBeenCalled();
    expect(depositDraft).not.toHaveBeenCalled();
    expect(downloadPmo).not.toHaveBeenCalled();
  });

  it("signs in, sends the file and the suggested details, and links to the draft", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({ ok: true, draftUrl: DRAFT_URL });
    const { store, downloadPmo, user } = await renderReview(DIRECT);
    setOverall(store, { publication: PUBLICATION });
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));

    expect(signIn).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ clientId: "client-1" }),
    );
    expect(downloadPmo).toHaveBeenCalledExactlyOnceWith({ gzip: true });
    expect(depositDraft).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        token: "token-1",
        community: "plasmogenepi",
        file: GZIP.blob,
        fileName: GZIP.fileName,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        record: expect.objectContaining({
          title: "MOZ2021: microhaplotype data in PMO format",
          keywords: expect.arrayContaining(["Portable Microhaplotype Object"]),
        }),
      }),
    );
    expect(await within(dialog).findByText("Your draft is ready on Zenodo")).toBeInTheDocument();
    const draft = within(dialog).getByRole("link", { name: /open the draft on zenodo/i });
    expect(draft).toHaveAttribute("href", DRAFT_URL);
    expect(draft).toHaveAttribute("rel", "noreferrer noopener");
    // The file was sent, not saved to the computer.
    expect(saveFile).not.toHaveBeenCalled();
  });

  it("keeps the link to the draft on the page after the dialog is closed", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({ ok: true, draftUrl: DRAFT_URL });
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    await within(dialog).findByText("Your draft is ready on Zenodo");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(
      await within(invitation()).findByRole("link", { name: /open the draft on zenodo/i }),
    ).toHaveAttribute("href", DRAFT_URL);
  });

  it("does not ask to sign in again for a second deposit", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValue({ ok: true, draftUrl: DRAFT_URL });
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    await within(dialog).findByText("Your draft is ready on Zenodo");
    await user.click(depositButton(dialog));
    await vi.waitFor(() => expect(depositDraft).toHaveBeenCalledTimes(2));
    expect(signIn).toHaveBeenCalledTimes(1);
  });

  it("says what to do when the browser blocks the sign-in window, and sends nothing", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, reason: "blocked" });
    const { downloadPmo, user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    expect(await within(dialog).findByText(/allow pop-ups for this site/i)).toBeInTheDocument();
    expect(depositDraft).not.toHaveBeenCalled();
    expect(downloadPmo).not.toHaveBeenCalled();
  });

  it("lets the user cancel while waiting for the sign-in", async () => {
    vi.mocked(signIn).mockImplementation(
      ({ signal }) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => resolve({ ok: false, reason: "cancelled" }));
        }),
    );
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    expect(within(dialog).getByText(/waiting for you to sign in/i)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await vi.waitFor(() =>
      expect(within(dialog).queryByText(/waiting for you to sign in/i)).not.toBeInTheDocument(),
    );
    expect(within(dialog).queryByText("The deposit was not finished")).not.toBeInTheDocument();
    expect(depositDraft).not.toHaveBeenCalled();
  });

  it("links to the started draft when a later step fails, and signs in again after an expired sign-in", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    vi.mocked(depositDraft).mockResolvedValueOnce({
      ok: false,
      step: "file",
      failure: "too-large",
      draftUrl: DRAFT_URL,
    });
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    expect(await within(dialog).findByText("The deposit was not finished")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/larger than Zenodo accepts.*A draft was started/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /open the draft on zenodo/i })).toHaveAttribute(
      "href",
      DRAFT_URL,
    );

    vi.mocked(depositDraft).mockResolvedValueOnce({
      ok: false,
      step: "draft",
      failure: "signed-out",
      draftUrl: null,
    });
    await user.click(depositButton(dialog));
    expect(await within(dialog).findByText(/no longer accepts the sign-in/i)).toBeInTheDocument();
    vi.mocked(depositDraft).mockResolvedValueOnce({ ok: true, draftUrl: DRAFT_URL });
    await user.click(depositButton(dialog));
    await within(dialog).findByText("Your draft is ready on Zenodo");
    expect(signIn).toHaveBeenCalledTimes(2);
  });

  it("shows how much of the file has been uploaded", async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, token: "token-1" });
    let finish: (() => void) | undefined;
    vi.mocked(depositDraft).mockImplementation(
      (input) =>
        new Promise((resolve) => {
          input.onStep?.("file");
          input.onProgress?.(12_000_000, 48_000_000);
          finish = () => resolve({ ok: true, draftUrl: DRAFT_URL });
        }),
    );
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    await user.click(depositButton(dialog));
    const bar = await within(dialog).findByRole("progressbar", {
      name: "Uploading the file, 12 MB of 48 MB",
    });
    expect(bar).toHaveAttribute("aria-valuenow", "12000000");
    expect(bar).toHaveAttribute("aria-valuemax", "48000000");
    expect(within(dialog).getByText("25%")).toBeInTheDocument();
    act(() => finish?.());
    expect(await within(dialog).findByText("Your draft is ready on Zenodo")).toBeInTheDocument();
    expect(within(dialog).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("keeps the steps for uploading by hand behind a disclosure", async () => {
    const { user } = await renderReview(DIRECT);
    const dialog = await openDialog(user, DIRECT);
    expect(
      within(dialog).queryByRole("link", { name: /open the zenodo upload page/i }),
    ).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: /upload it yourself instead/i }));
    expect(
      within(dialog).getByRole("link", { name: /open the zenodo upload page/i }),
    ).toHaveAttribute("href", "https://zenodo.org/uploads/new?community=plasmogenepi");
  });
});
