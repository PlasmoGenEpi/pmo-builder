/**
 * Plain titles for each kind of notice the review page lists.
 */
import type { NoticeGroup } from "@/features/shared";

const BY_CODE: Readonly<Record<string, string>> = {
  "draft/required-section": "A needed step is not finished",
  "draft/section-errors": "Steps with problems to fix",
  "draft/section-left-out": "Left out because they are not finished",
  "draft/samples-on-first-panel": "Every sample is put on the first panel",
  "draft/specimen-names-unused": "Specimen names are not used",
  "draft/one-project-for-all": "One project for every specimen",
  "draft/one-run-for-all": "One sequencing run for every library sample",
  "draft/unlinked-project-names": "Project names that link to nothing",
  "draft/unlinked-sequencing-names": "Sequencing run names that link to nothing",
  "merge/unresolved-names": "Names that do not match between tables",
  "merge/incomplete-name-fields": "Names missing that link tables together",
  "merge/runs-without-methods": "Runs without a method",
  "merge/several-panels-without-sample-info": "Several panels without a library sample table",
  "merge/duplicate-library-sample-names": "Samples that appear twice",
  "merge/specimens-added": "Samples added as specimens with no details",
  "merge/specimens-without-library-samples": "Specimens with no results",
  "schema/required": "Fields the PMO format needs are missing",
  "schema/pattern": "Values with characters the PMO format does not allow",
  "schema/type": "Values of the wrong kind for the PMO format",
  "schema/more": "More problems with the PMO format",
  "integrity/duplicate-name": "Names used more than once",
  "integrity/index-out-of-range": "Links that point at nothing",
  "integrity/index-not-integer": "Links that are not whole numbers",
  "integrity/end-before-start": "Locations that end before they start",
  "integrity/target-not-in-panel": "Targets that are not in the panel",
  "integrity/duplicate-representative-target": "Targets listed twice among the alleles",
  "integrity/duplicate-representative-seq": "Alleles listed twice",
  "integrity/duplicate-mhap-id": "Alleles counted twice for one sample",
  "integrity/duplicate-target-result": "Targets counted twice for one sample",
  "integrity/duplicate-library-sample-result": "Samples counted twice in one run",
};

const BY_PREFIX: readonly (readonly [string, string])[] = [
  ["schema/", "Does not match the PMO format"],
  ["integrity/", "Links inside the PMO that do not add up"],
  ["merge/", "The tables could not be put together"],
  ["build/", "Something went wrong"],
];

const FALLBACK: Readonly<Record<NoticeGroup["severity"], [string, string]>> = {
  error: ["Problem", "Problems"],
  warning: ["Warning", "Warnings"],
  info: ["Note", "Notes"],
};

/** A short title for a group of notices of one kind, such as "Names used more than once". */
export function noticeKindTitle(group: NoticeGroup): string {
  const known = BY_CODE[group.code];
  if (known !== undefined) return known;
  const prefixed = BY_PREFIX.find(([prefix]) => group.code.startsWith(prefix));
  if (prefixed !== undefined) return prefixed[1];
  const [one, many] = FALLBACK[group.severity];
  return group.notices.length === 1 ? one : many;
}
