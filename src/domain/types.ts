/**
 * Contracts shared by the domain modules and the user interface.
 *
 * Nothing in `src/domain` may import React or touch the DOM. Everything here
 * must survive `structuredClone`, because it crosses the worker boundary.
 */
/** The parts of a PMO the user can fill in. Each one is a step in the app. */
export const SECTION_IDS = [
  "microhaplotypes",
  "panel",
  "specimens",
  "librarySamples",
  "project",
  "sequencing",
  "bioinformatics",
  "readCounts",
] as const;

export type SectionId = (typeof SECTION_IDS)[number];

/** Only these two sections are needed to build a valid PMO. */
export const REQUIRED_SECTION_IDS = [
  "microhaplotypes",
  "panel",
] as const satisfies readonly SectionId[];

/** One row as it was read from the file: every cell is text, or `null` when blank. */
export type RawRow = Readonly<Record<string, string | null>>;

/**
 * A table as it was read from the file, before any typing.
 *
 * Cells stay text until build time. Only then is the mapping known, so the
 * columns mapped to text fields (names, dates, lists) can keep values such as
 * `0012` or `2024` exactly, while the other columns are typed the way pandas
 * would type them. See `typeTable` in `@/domain/import`.
 */
export interface RawTable {
  /** Column names in file order. Unique and never empty. */
  readonly columns: readonly string[];
  readonly rows: readonly RawRow[];
}

export type TableFormat = "delimited" | "xlsx";

/** What `parseFile` returns. */
export interface ParsedFile {
  readonly format: TableFormat;
  /** The delimiter that was detected, for delimited files. */
  readonly delimiter: string | null;
  /** Every sheet in a workbook, or `null` for delimited files. */
  readonly sheetNames: readonly string[] | null;
  /** The sheet that was read, or `null` for delimited files. */
  readonly sheetName: string | null;
  readonly table: RawTable;
}

export interface ParseOptions {
  /** Which sheet of a workbook to read. Defaults to the first. */
  readonly sheetName?: string;
  /** Lower size limits than the default `IMPORT_LIMITS` of `@/domain/import`. For tests. */
  readonly limits?: { readonly textBytes?: number; readonly workbookBytes?: number };
}

/** Every kind of table the app knows how to map columns for. */
export const FIELD_SET_IDS = [
  "microhaplotypes",
  "panelTargets",
  "genomes",
  "specimens",
  "librarySamples",
  "project",
  "sequencing",
  "bioinformaticsMethods",
  "bioinformaticsRuns",
  "readCountTotals",
  "readCountsByStage",
] as const;

export type FieldSetId = (typeof FIELD_SET_IDS)[number];

/**
 * What a field holds. `text`, `date` and `list` columns are kept as text when
 * the table is typed. `integer` and `number` columns are inferred.
 * `boolean` columns are read as yes or no (see `readBooleanCell` in
 * `@/domain/import`), and a value that is neither is reported.
 */
export type FieldKind = "text" | "integer" | "number" | "boolean" | "date" | "list";

/**
 * One PMO field that a column can be mapped to.
 *
 * Key rule. Where pmotools-ts has a builder for the table, the key is the
 * builder's option name without its `Col` suffix (`targetNameCol` becomes
 * `targetName`), so the build step can turn a mapping into options without a
 * lookup table. Where there is no builder (project, sequencing, genomes,
 * bioinformatics methods and runs), the key is the PMO field name in
 * snake_case (`project_name`).
 */
export interface FieldSpec {
  readonly key: string;
  /** Short name shown to the user, in sentence case. */
  readonly label: string;
  /** One plain sentence saying what belongs in the column. */
  readonly description: string;
  readonly required: boolean;
  readonly kind: FieldKind;
  /** Other header names that mean this field, most likely first. */
  readonly aliases: readonly string[];
  /** Optional heading that groups related optional fields in the mapping editor. */
  readonly group?: string;
  /**
   * Header names that must never be suggested for this field, not even as a
   * fuzzy match, because in lab tables they usually mean another field.
   * Compared after folding case and punctuation, like aliases.
   */
  readonly notAliases?: readonly string[];
}

/** A field key, or a choice of fields of which any one will do. */
export type FieldRequirement = string | { readonly anyOf: readonly string[] };

/**
 * Fields that only make sense together: when any field in `when` is mapped,
 * every requirement in `needs` must be mapped too. These mirror the checks
 * the pmotools-ts builders make (a location needs its chromosome, start and
 * end) and the schema's required fields (a parasite density needs its
 * method), so a mapping that breaks one is caught before the build.
 */
export interface FieldDependency {
  /** Stable identifier, such as `insert-location`. Safe to count; never holds user data. */
  readonly id: string;
  /** Field keys that switch the rule on. Usually also listed in `needs`. */
  readonly when: readonly string[];
  /** What must be mapped once any field in `when` is, in the order messages name them. */
  readonly needs: readonly FieldRequirement[];
}

export interface FieldSetSpec {
  readonly id: FieldSetId;
  /** What this table is called in the interface. */
  readonly title: string;
  readonly fields: readonly FieldSpec[];
  /** Whether unmapped columns may be carried into the PMO as extra fields. */
  readonly allowsAdditionalColumns: boolean;
  /** Fields that only make sense together. Empty when every field stands alone. */
  readonly dependencies: readonly FieldDependency[];
}

/** The user's choice of which column feeds which field. */
export interface ColumnMapping {
  /** Field key to column name. `null` means the field is not mapped. */
  readonly fields: Readonly<Record<string, string | null>>;
  /** Unmapped columns to carry into the PMO as extra fields. */
  readonly additionalColumns: readonly string[];
}

/** How sure the matcher is about one suggestion. */
export type MatchConfidence = "exact" | "alias" | "fuzzy" | "none";

export interface FieldMatch {
  readonly column: string | null;
  readonly confidence: MatchConfidence;
}

/** What `suggestMapping` returns: a starting mapping and how each field was matched. */
export interface MappingSuggestion {
  readonly mapping: ColumnMapping;
  readonly matches: Readonly<Record<string, FieldMatch>>;
}

/** A problem with a mapping that the user must fix before the table can be built. */
export type MappingProblem =
  | { readonly kind: "missing-required"; readonly fieldKey: string }
  | {
      readonly kind: "duplicate-column";
      readonly column: string;
      readonly fieldKeys: readonly string[];
    }
  | { readonly kind: "unknown-column"; readonly fieldKey: string; readonly column: string }
  | {
      /** Some fields of a {@link FieldDependency} are mapped and others it needs are not. */
      readonly kind: "incomplete-group";
      /** The dependency's `id`. */
      readonly dependencyId: string;
      /** The fields of `when` that are mapped, in field order. */
      readonly mappedKeys: readonly string[];
      /** The requirements of `needs` that are not met, in `needs` order. */
      readonly missing: readonly FieldRequirement[];
    }
  /** A column chosen to carry into the PMO that the table does not have. */
  | { readonly kind: "unknown-additional-column"; readonly column: string }
  /** A column chosen to carry into the PMO that is also mapped to a field. */
  | {
      readonly kind: "additional-column-mapped";
      readonly column: string;
      readonly fieldKey: string;
    };

/**
 * A message for the user that came out of importing, building or merging.
 *
 * The optional pointers say what the message is about, so the interface can
 * show it beside that section, table, field or column. Each is set only when
 * it is known; a notice with none is about the draft as a whole.
 */
export interface Notice {
  readonly severity: "error" | "warning" | "info";
  /** Stable identifier, such as a `PmoError` code. Safe to count; never holds user data. */
  readonly code: string;
  /** Plain-language text. May name the user's columns or samples, so it never leaves the browser. */
  readonly message: string;
  /** The sections the notice concerns, most relevant first. */
  readonly sections?: readonly SectionId[];
  /** The imported table it is about: a `TableRef` id. */
  readonly tableId?: string;
  /** The field it is about: a `FieldSpec` key of that table's field set. */
  readonly fieldKey?: string;
  /** The column of that table it is about. */
  readonly column?: string;
  /** The panel it is about: a `PanelEntry` id of the panel section. */
  readonly panelId?: string;
  /**
   * Where in the PMO it is, as a JSON Pointer such as `/specimen_info/0/lat_lon`.
   * Set on schema problems. May hold the name of an extra column, so it never leaves the browser.
   */
  readonly path?: string;
}

/** The parts of a {@link Notice} that say what it is about. */
export type NoticePointers = Pick<
  Notice,
  "sections" | "tableId" | "fieldKey" | "column" | "panelId"
>;

/**
 * Where one section stands.
 *
 * - `empty`: nothing has been entered.
 * - `incomplete`: started, but something the build needs is missing.
 * - `ready`: builds without errors. It may still carry warnings.
 * - `error`: the inputs are complete but the build failed.
 */
export type SectionStatus = "empty" | "incomplete" | "ready" | "error";
