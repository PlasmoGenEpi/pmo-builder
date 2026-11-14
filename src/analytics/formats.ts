import type { FileFormat } from "./vocabulary";

/**
 * Reads the format from a file name, for `recordTableImported`. Only the
 * extension is looked at, and only a fixed label comes back, so passing the
 * user's file name here is safe.
 */
export function fileFormatFromName(name: unknown): {
  readonly format: FileFormat;
  readonly gzip: boolean;
} {
  if (typeof name !== "string") return { format: "other", gzip: false };
  const lower = name.toLowerCase();
  const gzip = lower.endsWith(".gz");
  const base = gzip ? lower.slice(0, -3) : lower;
  const extension = base.slice(base.lastIndexOf(".") + 1);
  switch (extension) {
    case "csv":
    case "tsv":
    case "txt":
    case "xlsx":
      return { format: extension, gzip };
    default:
      return { format: "other", gzip };
  }
}
