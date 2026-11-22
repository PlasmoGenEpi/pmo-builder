import { act, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PmoPreview } from "@/domain/build";
import { createTestStore, renderWithStore } from "@/features/shared/testing";
import type { AppActions } from "@/state";

import { PmoPreviewBody } from "./PmoPreviewBody";

async function renderPreview(preview: PmoPreview) {
  const store = createTestStore();
  const real = store.getState().actions;
  const previewPmo = vi.fn<AppActions["previewPmo"]>(() => Promise.resolve(preview));
  store.setState({ actions: { ...real, previewPmo } });
  await renderWithStore(<PmoPreviewBody />, { store });
  await act(async () => {
    const result = await store.getState().actions.loadExample();
    if (!result.ok) throw new Error(result.reason);
    await store.getState().actions.flush();
  });
}

describe("PmoPreviewBody", () => {
  it("omits the total file size when a truncated preview stopped early", async () => {
    await renderPreview({ text: '{"a": 1}', truncated: true, length: null });

    expect(
      await screen.findByText("The first 8 B are shown here; the download has all of it."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The file is/)).toBeNull();
    expect(screen.getByRole("region", { name: "PMO preview" })).toHaveTextContent('{"a": 1}');
  });

  it("includes the total file size when a truncated preview provides length", async () => {
    await renderPreview({ text: '{"a": 1}', truncated: true, length: 1500 });

    expect(
      await screen.findByText(
        "The file is 1.5 KB. The first 8 B are shown here; the download has all of it.",
      ),
    ).toBeInTheDocument();
  });

  it("shows no truncation note when the full preview fits", async () => {
    await renderPreview({ text: '{"a": 1}', truncated: false, length: 8 });

    expect(await screen.findByRole("region", { name: "PMO preview" })).toHaveTextContent(
      '{"a": 1}',
    );
    expect(screen.queryByText(/are shown here/)).toBeNull();
  });
});
