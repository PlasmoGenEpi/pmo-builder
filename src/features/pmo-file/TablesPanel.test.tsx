import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { stringifyPmo } from "pmotools-ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildExamplePmo } from "@/domain/build/testing";
import type { TableInfo } from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import { workingPmoSessionOf } from "@/state";
import { createInThreadEngine } from "@/worker/engine";

import { TablesPanel } from "./TablesPanel";

vi.mock("@/features/review/saveFile", () => ({ saveFile: vi.fn<typeof saveFile>() }));

const EXAMPLE = buildExamplePmo();
const LISTED: readonly TableInfo[] = [{ id: "alleles", rows: 10 }];

const noop = (): void => undefined;

function createGate(): { readonly promise: Promise<void>; readonly open: () => void } {
  let open: () => void = noop;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

beforeEach(() => {
  vi.mocked(saveFile).mockReset();
});

describe("TablesPanel", () => {
  it("clears a download error when switching source from subset to original", async () => {
    const store = createTestStore();
    const file = new File([stringifyPmo(EXAMPLE)], "study.json");
    await workingPmoSessionOf(store).open({
      kind: "file",
      file,
      name: file.name,
      origin: { kind: "chosen" },
    });

    const user = userEvent.setup();
    const { rerender } = await renderWithStore(
      <TablesPanel tables={LISTED} subsetTables={LISTED} source="subset" />,
      { store },
    );

    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    expect(await screen.findByText("No subset has been made yet")).toBeInTheDocument();

    rerender(<TablesPanel tables={LISTED} subsetTables={LISTED} source="original" />);
    expect(screen.queryByText("No subset has been made yet")).not.toBeInTheDocument();
  });

  it("ignores a stale async download that settles after switching source or unmounting", async () => {
    const engine = createInThreadEngine();
    const held = createGate();
    const store = createTestStore({
      engine: {
        ...engine,
        workingPmo: async (call) => {
          if (call.request.kind === "table") {
            await held.promise;
            return { kind: "failed", message: "stale subset failure" };
          }
          return engine.workingPmo(call);
        },
      },
    });
    const file = new File([stringifyPmo(EXAMPLE)], "study.json");
    await workingPmoSessionOf(store).open({
      kind: "file",
      file,
      name: file.name,
      origin: { kind: "chosen" },
    });

    const user = userEvent.setup();
    const { rerender, unmount } = await renderWithStore(
      <TablesPanel tables={LISTED} subsetTables={LISTED} source="subset" />,
      { store },
    );

    await user.click(screen.getByRole("button", { name: "Download Allele table as csv" }));
    rerender(<TablesPanel tables={LISTED} subsetTables={LISTED} source="original" />);

    await act(async () => {
      held.open();
      await held.promise;
    });

    expect(
      screen.queryByText("The table could not be made. Open the file again."),
    ).not.toBeInTheDocument();
    expect(saveFile).not.toHaveBeenCalled();

    const heldBeforeUnmount = createGate();
    const storeUnmount = createTestStore({
      engine: {
        ...engine,
        workingPmo: async (call) => {
          if (call.request.kind === "tables") {
            await heldBeforeUnmount.promise;
          }
          return engine.workingPmo(call);
        },
      },
    });
    await workingPmoSessionOf(storeUnmount).open({
      kind: "file",
      file,
      name: file.name,
      origin: { kind: "chosen" },
    });

    unmount();
    const second = await renderWithStore(
      <TablesPanel tables={LISTED} subsetTables={null} source="original" />,
      { store: storeUnmount },
    );
    await user.click(screen.getByRole("button", { name: "Download all tables (.zip)" }));
    second.unmount();

    await act(async () => {
      heldBeforeUnmount.open();
      await heldBeforeUnmount.promise;
    });

    expect(saveFile).not.toHaveBeenCalled();
  });
});
