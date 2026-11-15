/**
 * What checking a PMO file gives, apart from the check itself, so pages can
 * use it without loading pmotools-ts onto the main thread. Import it by its
 * path, not through the `@/domain/build` barrel.
 */
import type { MergeSummary } from "./merge";
import type { PublicationSummary } from "./publication";

/** The only PMO version that can be published. */
export const PUBLISHABLE_PMO_VERSION = "1.1.0";

/** The most problems or warnings a check lists. The rest are counted. */
export const MAX_LISTED = 10;

/** What checking a PMO file found. */
export type PmoFileCheck =
  | {
      readonly kind: "ready";
      readonly summary: MergeSummary;
      readonly publication: PublicationSummary;
      /** Things worth a look that do not stop publishing, at most {@link MAX_LISTED}. */
      readonly warnings: readonly string[];
    }
  /** Larger than the browser can safely read. */
  | { readonly kind: "too-large"; readonly limit: number }
  /**
   * `gzip`: not a readable gzip file. `json`: not a JSON object, so not a PMO.
   * `not-pmo`: a JSON object without a PMO header.
   */
  | { readonly kind: "unreadable"; readonly reason: "gzip" | "json" | "not-pmo" }
  /** A PMO of another version. `declared` is `null` when the file names none. */
  | { readonly kind: "wrong-version"; readonly declared: string | null }
  | {
      readonly kind: "invalid";
      /**
       * At most {@link MAX_LISTED} problems. Problems that differ only in a
       * row number are listed once, with how many more there are like it.
       */
      readonly problems: readonly string[];
      /** How many problems are not covered by the list. */
      readonly unlisted: number;
    };
