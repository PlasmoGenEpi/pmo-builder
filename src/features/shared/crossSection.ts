/**
 * Notices from putting the tables together (the merge and the checks of the
 * whole PMO) that point at one section, so a step can show them where the
 * user can fix them, and only once per page.
 */
import { useCallback, useEffect, useId, useSyncExternalStore } from "react";

import { STATUS_ONLY_CODES } from "@/domain/build/sectionStatus";
import type { Notice, SectionId } from "@/domain/types";

/**
 * Whole-draft notices about names that link to nothing. The Specimens,
 * Library samples, Project and Sequencing steps already show this in their
 * name checks, so they are listed on the review page only.
 */
const SHOWN_BY_NAME_CHECKS: ReadonlySet<string> = new Set([
  "draft/unlinked-project-names",
  "draft/unlinked-sequencing-names",
]);

/**
 * The whole-draft notices that point at `section`, without those that only
 * restate the section's status or that the step's name checks show, and
 * without any whose message the section's own notices already hold.
 */
export function crossSectionNotices(
  overall: readonly Notice[],
  section: SectionId,
  own: readonly Notice[] = [],
): Notice[] {
  const shown = new Set(own.map((notice) => notice.message));
  return overall.filter(
    (notice) =>
      notice.sections?.includes(section) === true &&
      !STATUS_ONLY_CODES.has(notice.code) &&
      !SHOWN_BY_NAME_CHECKS.has(notice.code) &&
      !shown.has(notice.message),
  );
}

interface Mounted {
  readonly id: string;
  readonly section: SectionId;
}

/** The section results on screen, in the order they mounted. */
let mounted: readonly Mounted[] = [];
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): readonly Mounted[] {
  return mounted;
}

function changed(next: readonly Mounted[]): void {
  mounted = next;
  for (const listener of listeners) listener();
}

/**
 * Which section result on the page shows a cross-section notice: the first
 * one mounted for the most relevant of the notice's sections that is on the
 * page. Its sections are listed most relevant first.
 */
function ownerOf(notice: Notice, onPage: readonly Mounted[]): string | null {
  for (const section of notice.sections ?? []) {
    const first = onPage.find((entry) => entry.section === section);
    if (first !== undefined) return first.id;
  }
  return null;
}

/**
 * Registers a section result on the page and returns a test for whether a
 * cross-section notice is this result's to show, so a notice that points at
 * two sections shown on one page appears once, beside the more relevant one.
 */
export function useCrossSectionOwner(section: SectionId): (notice: Notice) => boolean {
  const id = useId();
  const onPage = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => {
    changed([...mounted, { id, section }]);
    return () => changed(mounted.filter((entry) => entry.id !== id));
  }, [id, section]);
  return useCallback((notice: Notice) => ownerOf(notice, onPage) === id, [onPage, id]);
}
