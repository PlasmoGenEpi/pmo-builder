/**
 * Error and warning codes that a usage record may count.
 *
 * A code reaches a record only in one of three forms:
 *
 * 1. A code on one of the lists below, unchanged.
 * 2. `<module>/other`, when the code has the right shape and a known module
 *    but is not on a list. New pmotools-ts codes land here until someone
 *    adds them, so a code can never carry free text.
 * 3. `other`, for everything else.
 *
 * So the set of values is closed, and the JSON Schema lists every one.
 */

/**
 * Every code pmotools-ts raises, as `"<module>/<reason>"`. `codes.test.ts`
 * reads the vendored library and fails when this list falls behind it.
 */
export const PMOTOOLS_CODES = [
  "integrity/duplicate-library-sample-result",
  "integrity/duplicate-mhap-id",
  "integrity/duplicate-name",
  "integrity/duplicate-representative-seq",
  "integrity/duplicate-representative-target",
  "integrity/duplicate-target-result",
  "integrity/end-before-start",
  "integrity/index-not-integer",
  "integrity/index-out-of-range",
  "integrity/target-not-in-panel",
  "io/invalid-gzip",
  "io/invalid-json",
  "io/invalid-utf8",
  "io/not-an-object",
  "io/not-serialisable",
  "merge/duplicate-library-sample-names",
  "merge/incomplete-name-fields",
  "merge/malformed-input",
  "merge/missing-name-field",
  "merge/missing-required-fields",
  "merge/no-panels",
  "merge/runs-without-methods",
  "merge/several-panels-without-sample-info",
  "merge/specimens-added",
  "merge/specimens-without-library-samples",
  "merge/unresolved-names",
  "metatable/density-method-length-mismatch",
  "metatable/density-method-type",
  "metatable/density-method-without-density",
  "metatable/duplicate-output-columns",
  "metatable/duplicate-selected-columns",
  "metatable/empty-delimiter",
  "metatable/invalid-density-columns",
  "metatable/invalid-integer",
  "metatable/invalid-list-value",
  "metatable/invalid-number",
  "metatable/invalid-plate-position",
  "metatable/invalid-taxon-id",
  "metatable/missing-columns",
  "metatable/missing-name-field",
  "metatable/not-a-table",
  "metatable/null-values",
  "metatable/plate-position-conflict",
  "metatable/plate-row-col-mismatch",
  "mhap/duplicate-target-seq",
  "mhap/incomplete-location",
  "mhap/incomplete-location-columns",
  "mhap/incomplete-masking-columns",
  "mhap/invalid-masking",
  "mhap/missing-additional-columns",
  "mhap/missing-columns",
  "mhap/missing-reads",
  "mhap/missing-run-name",
  "mhap/missing-seq",
  "mhap/missing-seqs",
  "mhap/missing-target-names",
  "mhap/pseudocigar-ref-loc-columns-unset",
  "mhap/pseudocigar-ref-loc-missing",
  "panel/conflicting-target-definition",
  "panel/duplicate-target-info",
  "panel/duplicate-target-names",
  "panel/empty-table",
  "panel/internal",
  "panel/invalid-delimiter",
  "panel/invalid-genome-info",
  "panel/invalid-integer",
  "panel/invalid-location-columns",
  "panel/invalid-table",
  "panel/invalid-target-index",
  "panel/location-without-genome",
  "panel/malformed-panel-info",
  "panel/malformed-target",
  "panel/missing-additional-columns",
  "panel/missing-columns",
  "panel/missing-location",
  "panel/missing-target-info",
  "panel/missing-target-name",
  "panel/no-panels",
  "validate/unknown-schema-version",
] as const;

/**
 * Codes the app itself raises: notice codes from the build and the draft,
 * import failures (`import/<reason>`), schema errors (`schema/<keyword>`,
 * hyphenated) and persistence and worker failures. `codes.test.ts` reads the
 * app's sources and fails when this list falls behind them.
 */
export const APP_CODES = [
  "bioinformatics/blank-group",
  "bioinformatics/method-column",
  "bioinformatics/method-gone",
  "bioinformatics/no-method-chosen",
  "bioinformatics/no-methods",
  "bioinformatics/no-steps",
  "bioinformatics/unknown-group-column",
  "bioinformatics/unknown-method",
  "build/unexpected",
  "build/unused-fields",
  "draft/one-project-for-all",
  "draft/one-run-for-all",
  "draft/required-section",
  "draft/restore-failed",
  "draft/samples-on-first-panel",
  "draft/save-failed",
  "draft/section-errors",
  "draft/section-left-out",
  "draft/specimen-names-unused",
  "draft/unlinked-project-names",
  "draft/unlinked-sequencing-names",
  "form/duplicate-name",
  "form/invalid-value",
  "form/missing-required",
  "genome/missing",
  "import/empty-file",
  "import/engine-stopped",
  "import/missing-sheet",
  "import/no-rows",
  "import/not-loaded",
  "import/too-large",
  "import/unexpected",
  "import/unreadable-file",
  "import/unreadable-workbook",
  "import/unsupported-format",
  "import/unsupported-type",
  "mapping/additional-column-mapped",
  "mapping/duplicate-column",
  "mapping/incomplete-group",
  "mapping/missing-required",
  "mapping/unknown-additional-column",
  "mapping/unknown-column",
  "panel/duplicate-panel-names",
  "panel/empty",
  "panel/invalid-name",
  "panel/missing-name",
  "panel/no-saved-panel",
  "schema/any-of",
  "schema/minimum",
  "schema/more",
  "schema/pattern",
  "schema/required",
  "schema/type",
  "table/blank-required",
  "table/file-missing",
  "table/invalid-boolean",
  "table/no-rows",
  "table/not-imported",
  "table/repeated-rows",
  "table/typing-failed",
  "table/unreadable",
  "worker/crashed",
] as const;

/** Modules whose unknown codes are counted as `<module>/other`. */
export const CODE_MODULES = [
  "integrity",
  "io",
  "merge",
  "metatable",
  "mhap",
  "panel",
  "validate",
  "import",
  "draft",
  "build",
  "storage",
  "worker",
  "app",
  "bioinformatics",
  "form",
  "genome",
  "mapping",
  "schema",
  "table",
] as const;

type CodeModule = (typeof CODE_MODULES)[number];

/** A code a usage record may hold. A closed set: no free text. */
export type IssueCode =
  | (typeof PMOTOOLS_CODES)[number]
  | (typeof APP_CODES)[number]
  | `${CodeModule}/other`
  | "other";

/** Every value `IssueCode` can take, for the JSON Schema. */
export const ISSUE_CODES: readonly IssueCode[] = [
  ...PMOTOOLS_CODES,
  ...APP_CODES,
  ...CODE_MODULES.map((module): `${CodeModule}/other` => `${module}/other`),
  "other",
];

/** Lowercase letters, digits and hyphens, then one slash, then the same. */
const CODE_SHAPE = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

const MAX_CODE_LENGTH = 64;

function isIssueCode(value: string): value is IssueCode {
  return ISSUE_CODES.some((code) => code === value);
}

function isModule(value: string): value is CodeModule {
  return CODE_MODULES.some((module) => module === value);
}

/**
 * Turns whatever a caller passes into a code that is safe to count. Accepts
 * `unknown` so that a message, a file name or an error object can be passed
 * by mistake without leaking.
 */
export function toIssueCode(value: unknown): IssueCode {
  if (typeof value !== "string" || value.length > MAX_CODE_LENGTH) return "other";
  // Schema codes carry the validator's keyword, which can be camel case (`schema/anyOf`).
  const code = value.replace(
    /([a-z0-9])([A-Z])/g,
    (_, before: string, upper: string) => `${before}-${upper.toLowerCase()}`,
  );
  if (code.length > MAX_CODE_LENGTH || !CODE_SHAPE.test(code)) return "other";
  if (isIssueCode(code)) return code;
  const module = code.slice(0, code.indexOf("/"));
  return isModule(module) ? `${module}/other` : "other";
}
