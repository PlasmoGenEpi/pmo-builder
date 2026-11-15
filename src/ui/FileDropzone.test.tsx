import { I18nProvider } from "@lingui/react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { i18n } from "@/i18n";

import { FileDropzone, type FileDropzoneProps } from "./FileDropzone";

const ACCEPT = [".csv", ".tsv", ".xlsx"];

/** `<Trans>` needs the i18n context, as in the app. */
function wrapper({ children }: { children: ReactNode }) {
  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}

function renderDropzone(props: Partial<FileDropzoneProps> = {}) {
  const onFileSelect = vi.fn<(file: File) => void>();
  const onRemove = vi.fn<() => void>();
  const view = render(
    <FileDropzone
      label="Allele table"
      accept={ACCEPT}
      file={null}
      onFileSelect={onFileSelect}
      onRemove={onRemove}
      {...props}
    />,
    { wrapper },
  );
  return { ...view, onFileSelect, onRemove };
}

function fileInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector("input[type=file]");
  if (!(input instanceof HTMLInputElement)) throw new Error("No file input");
  return input;
}

describe("FileDropzone", () => {
  it("is one button that names the table and the accepted types", () => {
    renderDropzone();
    expect(
      screen.getByRole("button", {
        name: "Allele table: Drag a file here or choose a file. Accepts CSV, TSV or XLSX",
      }),
    ).toBeInTheDocument();
  });

  it("passes on a chosen file of an accepted type", async () => {
    const user = userEvent.setup();
    const { container, onFileSelect } = renderDropzone();
    const file = new File(["SampleID,Locus\n"], "alleles.csv", { type: "text/csv" });
    await user.upload(fileInput(container), file);
    expect(onFileSelect).toHaveBeenCalledWith(file);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("accepts a dropped file", () => {
    const { onFileSelect } = renderDropzone();
    const file = new File(["a\tb\n"], "alleles.TSV");
    fireEvent.drop(screen.getByRole("button"), {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(onFileSelect).toHaveBeenCalledWith(file);
  });

  it("turns away a file of the wrong type and says what to choose", () => {
    const { onFileSelect } = renderDropzone();
    const file = new File(["%PDF"], "alleles.pdf", { type: "application/pdf" });
    fireEvent.drop(screen.getByRole("button"), {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "alleles.pdf is not a file type this step can read. Choose a CSV, TSV or XLSX file.",
    );
    expect(screen.getByRole("button")).toHaveAccessibleDescription(/alleles\.pdf/);
  });

  it("shows the chosen file with its size and shape, and removes it", async () => {
    const user = userEvent.setup();
    const { onRemove } = renderDropzone({
      file: { name: "alleles.csv", size: 1_284_311, rows: 12_431, columns: 6 },
    });
    expect(screen.getByText("alleles.csv")).toBeInTheDocument();
    expect(screen.getByText("1.3 MB, 12,431 rows, 6 columns")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove allele table file" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("does nothing while busy", () => {
    const { onFileSelect } = renderDropzone({ busy: "Reading 1.2 MB" });
    const file = new File(["a"], "alleles.csv");
    fireEvent.drop(screen.getByRole("button"), {
      dataTransfer: { files: [file], types: ["Files"] },
    });
    expect(onFileSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Reading 1.2 MB");
  });
});
