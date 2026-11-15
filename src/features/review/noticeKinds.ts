/**
 * Plain titles for each kind of notice the review page lists.
 */
import { plural, t } from "@lingui/core/macro";

import type { NoticeGroup } from "@/features/shared";

const BY_CODE: Readonly<Record<string, string>> = {
  "draft/required-section": t`A needed step is not finished`,
  "draft/section-errors": t`Steps with problems to fix`,
  "draft/section-left-out": t`Left out because they are not finished`,
  "draft/samples-on-first-panel": t`Every sample is put on the first panel`,
  "draft/specimen-names-unused": t`Specimen names are not used`,
  "draft/one-project-for-all": t`One project for every specimen`,
  "draft/one-run-for-all": t`One sequencing run for every library sample`,
  "draft/unlinked-project-names": t`Project names that link to nothing`,
  "draft/unlinked-sequencing-names": t`Sequencing run names that link to nothing`,
  "merge/unresolved-names": t`Names that do not match between tables`,
  "merge/incomplete-name-fields": t`Names missing that link tables together`,
  "merge/runs-without-methods": t`Runs without a method`,
  "merge/several-panels-without-sample-info": t`Several panels without a library sample table`,
  "merge/duplicate-library-sample-names": t`Samples that appear twice`,
  "merge/specimens-added": t`Samples added as specimens with no details`,
  "merge/specimens-without-library-samples": t`Specimens with no results`,
  "schema/required": t`Fields the PMO format needs are missing`,
  "schema/pattern": t`Values with characters the PMO format does not allow`,
  "schema/type": t`Values of the wrong kind for the PMO format`,
  "schema/more": t`More problems with the PMO format`,
  "integrity/duplicate-name": t`Names used more than once`,
  "integrity/index-out-of-range": t`Links that point at nothing`,
  "integrity/index-not-integer": t`Links that are not whole numbers`,
  "integrity/end-before-start": t`Locations that end before they start`,
  "integrity/target-not-in-panel": t`Targets that are not in the panel`,
  "integrity/duplicate-representative-target": t`Targets listed twice among the alleles`,
  "integrity/duplicate-representative-seq": t`Alleles listed twice`,
  "integrity/duplicate-mhap-id": t`Alleles counted twice for one sample`,
  "integrity/duplicate-target-result": t`Targets counted twice for one sample`,
  "integrity/duplicate-library-sample-result": t`Samples counted twice in one run`,
};

const BY_PREFIX: readonly (readonly [string, string])[] = [
  ["schema/", t`Does not match the PMO format`],
  ["integrity/", t`Links inside the PMO that do not add up`],
  ["merge/", t`The tables could not be put together`],
  ["build/", t`Something went wrong`],
];

const FALLBACK: Readonly<Record<NoticeGroup["severity"], (count: number) => string>> = {
  error: (count) => plural(count, { one: "Problem", other: "Problems" }),
  warning: (count) => plural(count, { one: "Warning", other: "Warnings" }),
  info: (count) => plural(count, { one: "Note", other: "Notes" }),
};

/** A short title for a group of notices of one kind, such as "Names used more than once". */
export function noticeKindTitle(group: NoticeGroup): string {
  const known = BY_CODE[group.code];
  if (known !== undefined) return known;
  const prefixed = BY_PREFIX.find(([prefix]) => group.code.startsWith(prefix));
  if (prefixed !== undefined) return prefixed[1];
  return FALLBACK[group.severity](group.notices.length);
}
