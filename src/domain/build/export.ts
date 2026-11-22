/**
 * Writing a built PMO out as a file.
 */
import {
  addPmoExtension,
  pmoBlob,
  pmoStream,
  stringifyPmoChunks,
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

/** Streams a PMO into a Blob with a file name, gzipped by default. */
export async function exportPmo(
  pmo: PortableMicrohaplotypeObject,
  options: ExportOptions = {},
): Promise<PmoFile> {
  const gzip = options.gzip ?? true;
  const fileName = pmoFileName(pmo, gzip);
  const blob = await pmoBlob(pmo, { gzip });
  return { blob, fileName };
}

/** Counts the byte length of a PMO file by draining its stream without retaining a Blob. */
export async function measurePmoSize(
  pmo: PortableMicrohaplotypeObject,
  options: ExportOptions = {},
): Promise<number> {
  const gzip = options.gzip ?? true;
  const reader = pmoStream(pmo, { gzip }).getReader();
  let total = 0;
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- draining one ReadableStream sequentially
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return total;
}

/** The start of a PMO's JSON text, for a preview. */
export interface PmoPreview {
  readonly text: string;
  readonly truncated: boolean;
  /** Length of the whole text, or `null` when previewing stopped early. */
  readonly length: number | null;
}

/**
 * The PMO as JSON text, cut at `maxLength` characters for a preview.
 *
 * Reads chunks from `stringifyPmoChunks` and stops as soon as `maxLength`
 * characters are collected and truncation is known, without walking or
 * building the rest of the PMO.
 */
export function previewPmo(pmo: PortableMicrohaplotypeObject, maxLength = 200_000): PmoPreview {
  const limit = Math.max(0, maxLength);
  const parts: string[] = [];
  let collected = 0;
  let truncated = false;
  for (const piece of stringifyPmoChunks(pmo, { ensureAscii: false })) {
    if (piece.length === 0) continue;
    const remaining = limit - collected;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (piece.length > remaining) {
      parts.push(piece.slice(0, remaining));
      collected = limit;
      truncated = true;
      break;
    }
    parts.push(piece);
    collected += piece.length;
  }
  const text = parts.join("");
  return {
    text,
    truncated,
    length: truncated ? null : text.length,
  };
}
