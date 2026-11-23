/**
 * File name helpers for PMO files. Kept free of `pmotools-ts` so the main
 * thread can import it without pulling the library into the main bundle.
 */

const PMO_EXTENSIONS = /(?:\.pmo)?(?:\.json(?:\.gz)?|\.gz)$/i;

/**
 * Strips `.json`, `.json.gz`, or `.gz` (and an optional `.pmo` before them)
 * from `fileName`, falling back to `"pmo"` when nothing remains.
 */
export function baseNameOf(fileName: string): string {
  const base = fileName.trim().replace(PMO_EXTENSIONS, "");
  return base === "" ? "pmo" : base;
}
