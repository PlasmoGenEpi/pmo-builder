/**
 * Writing a built PMO out as a file.
 */
import {
  addPmoExtension,
  gzipPmo,
  stringifyPmo,
  type PortableMicrohaplotypeObject,
} from "pmotools-ts";

/** Options for {@link exportPmo}. */
export interface ExportOptions {
  /** Gzip the file (`.pmo.json.gz`). Default `true`, as pmotools does. */
  readonly gzip?: boolean;
}

/** A PMO file ready to download. */
export interface PmoFile {
  readonly blob: Blob;
  readonly fileName: string;
}

/**
 * A file name for a PMO: the first project's name, or else the first
 * panel's, made safe for file systems, then `.pmo.json` or `.pmo.json.gz`.
 */
export function pmoFileName(pmo: PortableMicrohaplotypeObject, gzip: boolean): string {
  const base = pmo.project_info?.[0]?.project_name ?? pmo.panel_info[0]?.panel_name ?? "pmo";
  const safe = base.replaceAll(/[^A-Za-z0-9._-]+/g, "_").replaceAll(/^[._]+|[._]+$/g, "") || "pmo";
  return addPmoExtension(`${safe}.pmo`, { gzip });
}

/** Serialises a PMO with `stringifyPmo`, or `gzipPmo` when gzipped, into a Blob with a file name. */
export async function exportPmo(
  pmo: PortableMicrohaplotypeObject,
  options: ExportOptions = {},
): Promise<PmoFile> {
  const gzip = options.gzip ?? true;
  const fileName = pmoFileName(pmo, gzip);
  if (gzip) {
    const bytes = await gzipPmo(pmo);
    return { blob: new Blob([bytes], { type: "application/gzip" }), fileName };
  }
  return { blob: new Blob([stringifyPmo(pmo)], { type: "application/json" }), fileName };
}

/** The PMO as JSON text, cut at `maxLength` characters for a preview. */
export function previewPmo(
  pmo: PortableMicrohaplotypeObject,
  maxLength = 200_000,
): { readonly text: string; readonly truncated: boolean; readonly length: number } {
  const text = stringifyPmo(pmo, { ensureAscii: false });
  return {
    text: text.slice(0, maxLength),
    truncated: text.length > maxLength,
    length: text.length,
  };
}
