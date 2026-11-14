/**
 * How a section stands once the whole draft is put together. Kept apart from
 * the merge so the main thread can read it without loading pmotools-ts.
 */
import type { Notice, SectionId, SectionStatus } from "@/domain/types";

/**
 * Whole-draft notices that only say how a section stands, which its own
 * status already shows: needed and not finished, has errors, left out.
 */
export const STATUS_ONLY_CODES: ReadonlySet<string> = new Set([
  "draft/required-section",
  "draft/section-errors",
  "draft/section-left-out",
]);

/**
 * A section's status once the whole draft is put together: `error` when an
 * error from the merge, the schema check or the integrity check points at
 * it, as well as when the section has errors of its own. Every view (the
 * step, the sidebar, the review) reads this one status, so they agree. A
 * section with nothing in it stays `empty`.
 */
export function statusAfterMerge(
  section: SectionId,
  status: SectionStatus,
  mergeNotices: readonly Notice[],
): SectionStatus {
  if (status === "empty" || status === "error") return status;
  const pointed = mergeNotices.some(
    (notice) =>
      notice.severity === "error" &&
      !STATUS_ONLY_CODES.has(notice.code) &&
      notice.sections?.includes(section) === true,
  );
  return pointed ? "error" : status;
}
