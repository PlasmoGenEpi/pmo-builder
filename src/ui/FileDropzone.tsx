import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleExclamationPoint, FileSpreadsheet, Upload } from "lucide-react";
import { useId, useRef, useState, type DragEvent, type ReactNode } from "react";

import { intlLocale } from "@/i18n/languages";

import { Button } from "./Button";
import { cn } from "./cn";
import { formatBytes, formatCount } from "./format";
import { Spinner } from "./Spinner";

/** What the dropzone shows about a file once it has been read. */
export interface ChosenFile {
  name: string;
  /** Size in bytes. */
  size: number;
  rows?: number;
  columns?: number;
  /** Anything else worth a line, such as the sheet that was read. */
  detail?: ReactNode;
}

/** Props for {@link FileDropzone}. */
export interface FileDropzoneProps {
  /** What the file is, such as "Allele table". Used in the accessible names. */
  label: string;
  /** One sentence about what the file should contain. */
  description?: ReactNode;
  /** File name endings that are allowed, with the dot, such as `[".csv", ".tsv", ".xlsx"]`. */
  accept: readonly string[];
  /** The file that has been read, or `null` before one is chosen. */
  file: ChosenFile | null;
  /** Called with a file of an accepted type. */
  onFileSelect: (file: File) => void;
  onRemove: () => void;
  /** True, or a message such as "Reading 12 MB", while the file is being read. */
  busy?: boolean | string;
  /** A problem with the chosen file. Say what is wrong and what to do. */
  error?: string | null;
  disabled?: boolean;
  className?: string;
}

function accepts(name: string, accept: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return accept.some((ending) => lower.endsWith(ending.toLowerCase()));
}

function listEndings(accept: readonly string[]): string {
  const names = accept.map((ending) => ending.replace(/^\./, "").toUpperCase());
  return new Intl.ListFormat(intlLocale(), { type: "disjunction" }).format(names);
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes("Files");
}

/**
 * Lets the user choose one file by dragging it in, clicking, or with the
 * keyboard. Once read, it shows the file's name, size and shape with Replace
 * and Remove actions. Files of other types are turned away with a message.
 */
export function FileDropzone({
  label,
  description,
  accept,
  file,
  onFileSelect,
  onRemove,
  busy = false,
  error,
  disabled = false,
  className,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const messageId = `dropzone-${id}-message`;
  const [dragDepth, setDragDepth] = useState(0);
  const [rejection, setRejection] = useState<string | null>(null);
  const isBusy = busy !== false;
  const inactive = disabled || isBusy;
  const shownError = rejection ?? error ?? null;
  const dragging = dragDepth > 0 && !inactive;
  const fileTypes = listEndings(accept);
  const fileLabel = label.toLowerCase();
  const busyMessage = typeof busy === "string" ? busy : t`Reading the file`;

  function choose() {
    if (!inactive) inputRef.current?.click();
  }

  function take(files: FileList | null) {
    const chosen = files?.[0];
    if (chosen === undefined) return;
    if (!accepts(chosen.name, accept)) {
      const fileName = chosen.name;
      setRejection(
        t`${fileName} is not a file type this step can read. Choose a ${fileTypes} file.`,
      );
      return;
    }
    setRejection(null);
    onFileSelect(chosen);
  }

  const dragHandlers = {
    onDragEnter: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragDepth((depth) => depth + 1);
    },
    onDragOver: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = inactive ? "none" : "copy";
    },
    onDragLeave: () => setDragDepth((depth) => Math.max(depth - 1, 0)),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragDepth(0);
      if (!inactive) take(event.dataTransfer.files);
    },
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      hidden
      accept={accept.join(",")}
      aria-label={t`Choose ${fileLabel} file`}
      onChange={(event) => {
        take(event.target.files);
        // Allow choosing the same file again after it was removed.
        event.target.value = "";
      }}
    />
  );

  const message = shownError ? (
    <p id={messageId} role="alert" className="flex items-start gap-1.5 text-sm text-danger-text">
      <CircleExclamationPoint aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <span>{shownError}</span>
    </p>
  ) : null;

  if (file !== null) {
    const { rows, columns } = file;
    const rowCount = rows === undefined ? "" : formatCount(rows);
    const columnCount = columns === undefined ? "" : formatCount(columns);
    const shape = new Intl.ListFormat(intlLocale(), { type: "unit", style: "short" }).format(
      [
        formatBytes(file.size),
        rows === undefined
          ? null
          : plural(rows, { one: `${rowCount} row`, other: `${rowCount} rows` }),
        columns === undefined
          ? null
          : plural(columns, { one: `${columnCount} column`, other: `${columnCount} columns` }),
      ].filter((part) => part !== null),
    );

    return (
      <div className={cn("flex flex-col gap-2", className)}>
        <div
          {...dragHandlers}
          className={cn(
            "flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border p-4 transition-colors",
            dragging
              ? "border-accent bg-accent-subtle"
              : shownError
                ? "border-danger bg-surface"
                : "border-border bg-surface",
          )}
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-subtle text-accent-text">
            {isBusy ? (
              <Spinner label={null} />
            ) : (
              <FileSpreadsheet aria-hidden="true" className="size-5" />
            )}
          </span>
          <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
            <p className="truncate font-mono text-sm font-medium text-text" title={file.name}>
              {file.name}
            </p>
            <p className="text-sm text-text-muted" aria-live="polite">
              {isBusy ? busyMessage : shape}
            </p>
            {file.detail && !isBusy ? (
              <p className="text-sm text-text-muted">{file.detail}</p>
            ) : null}
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              onClick={choose}
              disabled={inactive}
              aria-label={t`Replace ${fileLabel} file`}
            >
              {t({
                message: "Replace",
                comment: "Button: choose another file in place of this one",
              })}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setRejection(null);
                onRemove();
              }}
              disabled={inactive}
              aria-label={t`Remove ${fileLabel} file`}
            >
              {t({ message: "Remove", comment: "Button: remove this file" })}
            </Button>
          </div>
          {input}
        </div>
        {message}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <button
        type="button"
        {...dragHandlers}
        onClick={choose}
        disabled={disabled}
        aria-busy={isBusy || undefined}
        aria-describedby={shownError ? messageId : undefined}
        className={cn(
          "group flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors duration-100",
          "disabled:cursor-not-allowed disabled:opacity-60",
          dragging
            ? "border-accent bg-accent-subtle"
            : shownError
              ? "border-danger bg-surface"
              : "border-border-strong bg-surface hover:border-accent hover:bg-surface-subtle",
          isBusy && "cursor-progress",
        )}
      >
        <span
          className={cn(
            "flex size-10 items-center justify-center rounded-full transition-colors",
            dragging ? "bg-accent text-accent-fg" : "bg-surface-muted text-text-muted",
          )}
        >
          {isBusy ? <Spinner label={null} /> : <Upload aria-hidden="true" className="size-5" />}
        </span>
        <span className="flex flex-col gap-1">
          <span className="sr-only">{label}:</span>{" "}
          <span className="text-base text-text">
            {isBusy ? (
              busyMessage
            ) : dragging ? (
              t`Drop to use this file`
            ) : (
              <Trans>
                Drag a file here or{" "}
                <span className="font-medium text-accent-text">choose a file</span>
              </Trans>
            )}
          </span>
          <span className="text-sm text-text-muted">
            <Trans>
              <span className="sr-only">. Accepts</span> {fileTypes}
            </Trans>
            {description ? <span className="block">{description}</span> : null}
          </span>
        </span>
      </button>
      {input}
      {isBusy ? <output className="sr-only">{busyMessage}</output> : null}
      {message}
    </div>
  );
}
