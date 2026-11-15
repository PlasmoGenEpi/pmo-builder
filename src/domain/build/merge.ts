/**
 * Building a whole draft: every section, then `mergeToPmo`, `validatePmo` and
 * `checkPmoIntegrity`, with a merge summary and notices that name the
 * sections involved.
 */
import {
  PmoError,
  checkPmoIntegrity,
  collectWarnings,
  isMissing,
  mergeToPmo,
  validatePmo,
  type IntegrityIssue,
  type IssueDetails,
  type MergeParts,
  type MissingNameField,
  type PathSegment,
  type PmoWarning,
  type PortableMicrohaplotypeObject,
  type ProjectInfo,
  type SchemaValidationError,
  type SequencingInfo,
} from "pmotools-ts";

import { unreachable, type Draft } from "@/domain/draft";
import {
  REQUIRED_SECTION_IDS,
  SECTION_IDS,
  type Notice,
  type SectionId,
  type SectionStatus,
} from "@/domain/types";

import { buildBioinformatics } from "./bioinformatics";
import type { BuildContext } from "./context";
import { buildMicrohaplotypes } from "./microhaplotypes";
import { countText, listItems, makeNotice, quoteItems, withLibraryDetail } from "./notices";
import { buildPanel } from "./panel";
import { buildProject, buildSequencing } from "./records";
import { summarisePublication, type PublicationSummary } from "./publication";
import { buildReadCounts } from "./readCounts";
import type { SectionResult, SectionResults } from "./results";
import { buildLibrarySamples, buildSpecimens } from "./samples";

/** The counts shown after a merge, as the old app showed them. */
export interface MergeSummary {
  readonly specimens: number;
  readonly librarySamples: number;
  readonly librarySamplesWithDetections: number;
  readonly panels: number;
  readonly targets: number;
  /** Targets with at least one detected microhaplotype. */
  readonly targetsWithCalls: number;
  readonly genomes: number;
  readonly sequencingRuns: number;
  readonly projects: number;
  readonly bioinformaticsRuns: number;
  readonly librarySamplesWithReadCounts: number;
}

/** What merging gave. */
export type PmoOutcome =
  /** The required sections are not ready, or a section has errors, so no merge was tried. */
  | { readonly kind: "not-built" }
  /** `mergeToPmo` threw. The notices say why. */
  | { readonly kind: "merge-failed" }
  | {
      readonly kind: "built";
      readonly pmo: PortableMicrohaplotypeObject;
      /** True when the PMO passes the schema and has no integrity errors. */
      readonly valid: boolean;
      /**
       * How many places in the PMO fail the schema: errors at the same path
       * count once. `0` when the PMO matches the schema.
       */
      readonly schemaErrors: number;
      readonly summary: MergeSummary;
      /** What a repository record would say about the PMO, and the personal details it holds. */
      readonly publication: PublicationSummary;
    };

/** The result of building a whole draft. */
export interface MergeResult {
  /**
   * - `empty`: nothing entered anywhere.
   * - `incomplete`: a required section is not ready yet.
   * - `error`: a section has errors, the merge failed, or the PMO is not valid.
   * - `ready`: a valid PMO was built. Notices may still carry warnings.
   */
  readonly status: SectionStatus;
  readonly notices: readonly Notice[];
  readonly outcome: PmoOutcome;
}

/** Options for {@link mergeSections} and {@link buildDraft}. */
export interface MergeOptions {
  /** `pmo_header.creation_date`. Defaults to today, as pmotools-ts does. */
  readonly creationDate?: string;
  /** Most schema errors listed before the rest are counted. Default 20. */
  readonly maxSchemaNotices?: number;
}

/** How each section is named in messages. */
export const SECTION_LABELS: Readonly<Record<SectionId, string>> = {
  microhaplotypes: "Microhaplotypes",
  panel: "Panel",
  specimens: "Specimens",
  librarySamples: "Library samples",
  project: "Project",
  sequencing: "Sequencing",
  bioinformatics: "Bioinformatics",
  readCounts: "Read counts",
};

function draftNotice(
  notice: Pick<Notice, "severity" | "code" | "message">,
  sections: readonly SectionId[],
): Notice {
  return makeNotice(notice.severity, notice.code, notice.message, { sections });
}

/** Builds every section of a draft. */
export function buildAllSections(draft: Draft, context: BuildContext): SectionResults {
  return {
    microhaplotypes: buildMicrohaplotypes(draft.microhaplotypes, context),
    panel: buildPanel(draft.panel, context),
    specimens: buildSpecimens(draft.specimens, context),
    librarySamples: buildLibrarySamples(draft.librarySamples, context),
    project: buildProject(draft.project, context),
    sequencing: buildSequencing(draft.sequencing, context),
    bioinformatics: buildBioinformatics(draft.bioinformatics, context),
    readCounts: buildReadCounts(draft.readCounts, context),
  };
}

/** Builds one section of a draft. */
export function buildSection<S extends SectionId>(
  section: S,
  draft: Draft,
  context: BuildContext,
): SectionResult<S> {
  const builders: {
    readonly [K in SectionId]: (draft: Draft, context: BuildContext) => SectionResult<K>;
  } = {
    microhaplotypes: (d, c) => buildMicrohaplotypes(d.microhaplotypes, c),
    panel: (d, c) => buildPanel(d.panel, c),
    specimens: (d, c) => buildSpecimens(d.specimens, c),
    librarySamples: (d, c) => buildLibrarySamples(d.librarySamples, c),
    project: (d, c) => buildProject(d.project, c),
    sequencing: (d, c) => buildSequencing(d.sequencing, c),
    bioinformatics: (d, c) => buildBioinformatics(d.bioinformatics, c),
    readCounts: (d, c) => buildReadCounts(d.readCounts, c),
  };
  const build: (draft: Draft, context: BuildContext) => SectionResult<S> = builders[section];
  return build(draft, context);
}

/** Builds every section and merges them. */
export function buildDraft(
  draft: Draft,
  context: BuildContext,
  options: MergeOptions = {},
): { readonly sections: SectionResults; readonly merge: MergeResult } {
  const sections = buildAllSections(draft, context);
  return { sections, merge: mergeSections(sections, options) };
}

const REQUIRED_HINTS: Readonly<Record<(typeof REQUIRED_SECTION_IDS)[number], string>> = {
  microhaplotypes: "Import the allele table on the Microhaplotypes step.",
  panel: "Add the panel's target table on the Panel step.",
};

/**
 * Merges built sections into a PMO when the required sections are ready and
 * no section has errors, then validates it. Optional sections that are not
 * finished are left out, with a warning.
 */
export function mergeSections(results: SectionResults, options: MergeOptions = {}): MergeResult {
  const statuses = SECTION_IDS.map((id) => results[id].status);
  if (statuses.every((status) => status === "empty")) {
    return { status: "empty", notices: [], outcome: { kind: "not-built" } };
  }
  const notices: Notice[] = [];
  const withErrors = SECTION_IDS.filter((id) => results[id].status === "error");
  for (const id of REQUIRED_SECTION_IDS) {
    const status = results[id].status;
    if (status === "empty" || status === "incomplete") {
      notices.push(
        draftNotice(
          {
            severity: "error",
            code: "draft/required-section",
            message: `${SECTION_LABELS[id]} is needed and is not finished yet. ${REQUIRED_HINTS[id]}`,
          },
          [id],
        ),
      );
    }
  }
  if (withErrors.length > 0) {
    notices.push(
      draftNotice(
        {
          severity: "error",
          code: "draft/section-errors",
          message: `Fix the problems in ${listItems(withErrors.map((id) => SECTION_LABELS[id]))} before the PMO can be built.`,
        },
        withErrors,
      ),
    );
  }
  const mhap = results.microhaplotypes.fragment;
  const panel = results.panel.fragment;
  if (withErrors.length > 0 || mhap === null || panel === null) {
    return {
      status: withErrors.length > 0 ? "error" : "incomplete",
      notices,
      outcome: { kind: "not-built" },
    };
  }

  const included = (id: SectionId): boolean => results[id].status === "ready";
  for (const id of SECTION_IDS) {
    if (results[id].status === "incomplete") {
      notices.push(
        draftNotice(
          {
            severity: "warning",
            code: "draft/section-left-out",
            message: `${SECTION_LABELS[id]} is not finished, so it is left out of the PMO.`,
          },
          [id],
        ),
      );
    }
  }
  const panelCount = panel.merged.panel_info.length;
  const firstPanel = panel.merged.panel_info[0]?.panel_name ?? "";
  if (panelCount > 1 && included("specimens") && !included("librarySamples")) {
    notices.push(
      draftNotice(
        {
          severity: "warning",
          code: "draft/samples-on-first-panel",
          message: `There are ${panelCount} panels but no library sample table, so every sample is put on panel "${firstPanel}". Add a library sample table to say which panel each sample used.`,
        },
        ["panel", "librarySamples"],
      ),
    );
  }

  const libraries = results.librarySamples.fragment;
  if (libraries !== null && !included("specimens")) {
    const renamed = libraries.some(
      (library) =>
        library.specimen_name !== undefined &&
        library.specimen_name !== library.library_sample_name,
    );
    if (renamed) {
      notices.push(
        draftNotice(
          {
            severity: "warning",
            code: "draft/specimen-names-unused",
            message:
              "Without a specimen table, each library sample becomes its own specimen, so the specimen names in the library sample table are not used. Add a specimen table to keep them.",
          },
          ["librarySamples", "specimens"],
        ),
      );
    }
  }
  const bio = results.bioinformatics.fragment;
  const oneProject = oneForAll(
    results.project.fragment,
    results.specimens.fragment,
    "project_name",
  );
  const oneRun = oneForAll(
    results.sequencing.fragment,
    results.librarySamples.fragment,
    "sequencing_info_name",
  );
  notices.push(...unlinkedNameNotices(results));
  const parts: MergeParts = {
    mhapInfo: mhap,
    panelTargetInfo: panel.merged,
    specimenInfo: results.specimens.fragment,
    librarySampleInfo: results.librarySamples.fragment,
    // One project or run that no record names is linked after the merge,
    // because the library links them by name.
    sequencingInfo: oneRun === null ? results.sequencing.fragment : null,
    projectInfo: oneProject === null ? results.project.fragment : null,
    bioinfoMethodInfo: bio === null || bio.methods.length === 0 ? null : bio.methods,
    bioinfoRunInfo: bio === null || bio.runs.length === 0 ? null : bio.runs,
    readCountsByStageInfo: results.readCounts.fragment,
  };
  const context: MergeContext = {
    librarySamplesGiven: included("librarySamples"),
    specimensGiven: included("specimens"),
    specimens: results.specimens.fragment?.length ?? 0,
    librarySamples: results.librarySamples.fragment?.length ?? 0,
    projects: results.project.fragment?.length ?? 0,
    sequencingRuns: results.sequencing.fragment?.length ?? 0,
  };

  let pmo: PortableMicrohaplotypeObject;
  try {
    const { result, warnings } = collectWarnings((onWarning) =>
      mergeToPmo(parts, {
        onWarning,
        ...(options.creationDate === undefined ? {} : { creationDate: options.creationDate }),
      }),
    );
    pmo = result;
    notices.push(...warnings.map((warning) => mergeWarningNotice(warning)));
    if (oneProject !== null) {
      pmo = linkProjectToAll(pmo, oneProject);
      notices.push(
        draftNotice(
          {
            severity: "info",
            code: "draft/one-project-for-all",
            message: `Project "${oneProject.project_name}" is applied to all ${countText(pmo.specimen_info.length, "specimen")}, because ${
              context.specimensGiven
                ? "the specimen table names no project"
                : "there is no specimen table to name a project for each"
            }.`,
          },
          ["project", "specimens"],
        ),
      );
    }
    if (oneRun !== null) {
      pmo = linkRunToAll(pmo, oneRun);
      notices.push(
        draftNotice(
          {
            severity: "info",
            code: "draft/one-run-for-all",
            message: `Sequencing run "${oneRun.sequencing_info_name}" is applied to all ${countText(pmo.library_sample_info.length, "library sample")}, because ${
              context.librarySamplesGiven
                ? "the library sample table names no sequencing run"
                : "there is no library sample table to name a run for each"
            }.`,
          },
          ["sequencing", "librarySamples"],
        ),
      );
    }
  } catch (error) {
    notices.push(...mergeErrorNotices(error, context));
    return { status: "error", notices, outcome: { kind: "merge-failed" } };
  }

  const validation = validatePmo(pmo);
  let valid = validation.valid;
  let schemaProblems = 0;
  if (!validation.valid) {
    const max = options.maxSchemaNotices ?? 20;
    const groups = groupByPath(validation.errors);
    // Errors past the library's cap are not returned, so each counts as one problem.
    schemaProblems = groups.length + validation.errorCount - validation.errors.length;
    const listed = groups.slice(0, max);
    notices.push(...listed.map((group) => schemaNotice(group, pmo)));
    const rest = schemaProblems - listed.length;
    if (rest > 0) {
      notices.push(
        draftNotice(
          {
            severity: "error",
            code: "schema/more",
            message: `${rest} more ${rest === 1 ? "problem" : "problems"} with the PMO format ${rest === 1 ? "is" : "are"} not listed.`,
          },
          [],
        ),
      );
    }
  }
  const issues = checkPmoIntegrity(pmo);
  for (const issue of issues) {
    if (issue.severity === "error") valid = false;
    notices.push(integrityNotice(issue));
  }
  return {
    status: valid ? "ready" : "error",
    notices,
    outcome: {
      kind: "built",
      pmo,
      valid,
      schemaErrors: schemaProblems,
      summary: summarisePmo(pmo),
      publication: summarisePublication(pmo),
    },
  };
}

interface MergeContext {
  readonly librarySamplesGiven: boolean;
  readonly specimensGiven: boolean;
  /** How many specimens and library samples the tables give, when they are given. */
  readonly specimens: number;
  readonly librarySamples: number;
  /** How many projects and sequencing runs go into the merge. */
  readonly projects: number;
  readonly sequencingRuns: number;
}

/**
 * The one project or sequencing run to link to every record, or `null`.
 * That is when exactly one is defined and no record names one: the library
 * links by name, so without this a lab that types one project and has no
 * specimen table could not build a PMO. With two or more, or when some
 * records name one, nothing is guessed and the merge says what is needed.
 */
function oneForAll<T>(
  defined: readonly T[] | null,
  records: readonly Readonly<Record<string, unknown>>[] | null,
  field: string,
): T | null {
  if (defined === null || defined.length !== 1) return null;
  if (records !== null && records.some((record) => !isMissing(record[field]))) return null;
  return defined[0] ?? null;
}

/** The PMO with `project` as its only project and every specimen linked to it. */
function linkProjectToAll(
  pmo: PortableMicrohaplotypeObject,
  project: ProjectInfo,
): PortableMicrohaplotypeObject {
  return {
    ...pmo,
    project_info: [project],
    specimen_info: pmo.specimen_info.map(({ project_name: _name, ...specimen }) => ({
      ...specimen,
      project_id: 0,
    })),
  };
}

/** The PMO with `run` as its only sequencing run and every library sample linked to it. */
function linkRunToAll(
  pmo: PortableMicrohaplotypeObject,
  run: SequencingInfo,
): PortableMicrohaplotypeObject {
  return {
    ...pmo,
    sequencing_info: [run],
    library_sample_info: pmo.library_sample_info.map(
      ({ sequencing_info_name: _name, ...library }) => ({ ...library, sequencing_info_id: 0 }),
    ),
  };
}

/** The distinct names a set of records gives in `field`. */
function namesIn(
  records: readonly Readonly<Record<string, unknown>>[] | null,
  field: string,
): string[] {
  const found = new Set<string>();
  for (const record of records ?? []) {
    const value = record[field];
    if (!isMissing(value)) found.add(String(value));
  }
  return [...found];
}

/**
 * Warnings for project and sequencing run names that a table gives but that
 * link to nothing, because no project or run is in the PMO. The library then
 * keeps each name as it is, in a field the schema does not know, so the PMO
 * is still valid but the link is lost.
 */
function unlinkedNameNotices(results: SectionResults): Notice[] {
  const notices: Notice[] = [];
  const projects = namesIn(results.specimens.fragment, "project_name");
  if (projects.length > 0 && results.project.fragment === null) {
    notices.push(
      draftNotice(
        {
          severity: "warning",
          code: "draft/unlinked-project-names",
          message: `The specimen table names ${projects.length === 1 ? "the project" : "the projects"} ${quoteItems(projects)}, but ${
            results.project.status === "empty"
              ? "no project is entered"
              : "the Project step is not finished"
          }, so the PMO keeps the ${projects.length === 1 ? "name" : "names"} without linking ${projects.length === 1 ? "it" : "them"} to a project. Add the project on the Project step, or unmap the project name column.`,
        },
        ["specimens", "project"],
      ),
    );
  }
  const runs = namesIn(results.librarySamples.fragment, "sequencing_info_name");
  if (runs.length > 0 && results.sequencing.fragment === null) {
    notices.push(
      draftNotice(
        {
          severity: "warning",
          code: "draft/unlinked-sequencing-names",
          message: `The library sample table names ${runs.length === 1 ? "the sequencing run" : "the sequencing runs"} ${quoteItems(runs)}, but ${
            results.sequencing.status === "empty"
              ? "no sequencing run is entered"
              : "the Sequencing step is not finished"
          }, so the PMO keeps the ${runs.length === 1 ? "name" : "names"} without linking ${runs.length === 1 ? "it" : "them"} to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.`,
        },
        ["librarySamples", "sequencing"],
      ),
    );
  }
  return notices;
}

function names(details: Readonly<Record<string, unknown>>, key: string): string[] {
  const value = details[key];
  return Array.isArray(value) ? value.map((item: unknown) => String(item)) : [];
}

/** The two sections and the sentence for each kind of name the merge could not resolve. */
function unresolvedText(
  kind: string,
  list: string,
  context: MergeContext,
): { readonly sections: readonly SectionId[]; readonly message: string } | null {
  switch (kind) {
    case "projects":
      return {
        sections: ["specimens", "project"],
        message: `These project names are in the specimen table but not in the Project step: ${list}. Add the projects or correct the names.`,
      };
    case "sequencing":
      return {
        sections: ["librarySamples", "sequencing"],
        message: `These sequencing run names are in the library sample table but not in the Sequencing step: ${list}. Add the runs or correct the names.`,
      };
    case "specimens":
      return {
        sections: ["librarySamples", "specimens"],
        message: `These specimen names are in the library sample table but not in the specimen table: ${list}. Add them to the specimen table or correct the names.`,
      };
    case "panels":
      return {
        sections: ["librarySamples", "panel"],
        message: `These panel names are in the library sample table but no panel has that name: ${list}. Rename the panel on the Panel step or correct the table.`,
      };
    case "targets":
      return {
        sections: ["microhaplotypes", "panel"],
        message: `These targets are in the allele table but not in the panel: ${list}. Check that the panel's target table lists every target.`,
      };
    case "bioinformaticsRuns":
      return {
        sections: ["microhaplotypes", "bioinformatics"],
        message: `These run names are in the allele table but not among the bioinformatics runs: ${list}. Add the runs or correct the names.`,
      };
    case "librarySamples":
      return {
        sections: ["microhaplotypes", "librarySamples"],
        message: `These samples are in the allele table but not in the library sample table: ${list}. Add them to the library sample table or correct the names.`,
      };
    case "readCountsBioinformaticsRuns":
      return {
        sections: ["readCounts", "bioinformatics"],
        message: `These run names have read counts but are not among the bioinformatics runs: ${list}.`,
      };
    case "readCountsLibrarySamples":
      return context.librarySamplesGiven
        ? {
            sections: ["readCounts", "librarySamples"],
            message: `These samples have read counts but are not in the library sample table: ${list}.`,
          }
        : {
            sections: ["readCounts", "microhaplotypes"],
            message: `These samples have read counts but are not in the allele table: ${list}.`,
          };
    case "readCountsTargets":
      return {
        sections: ["readCounts", "panel"],
        message: `These targets have read counts but are not in the panel: ${list}.`,
      };
    default:
      return null;
  }
}

const MISSING_NAME_PARTS: ReadonlySet<string> = new Set<MissingNameField["part"]>([
  "specimenInfo",
  "librarySampleInfo",
  "mhapInfo",
  "readCountsByStageInfo",
]);

function isMissingNameField(value: unknown): value is MissingNameField {
  return (
    isRecord(value) &&
    typeof value["part"] === "string" &&
    MISSING_NAME_PARTS.has(value["part"]) &&
    typeof value["count"] === "number" &&
    Array.isArray(value["examples"])
  );
}

/** The `missing` list of a `merge/incomplete-name-fields` error. */
function missingNameFields(details: IssueDetails): MissingNameField[] {
  const missing = details["missing"];
  return Array.isArray(missing) ? missing.filter(isMissingNameField) : [];
}

/** ` ("S1" and "S2")`, or ` (such as "S1" and "S2")` when there are more than the examples. */
function examplesText(missing: MissingNameField): string {
  const named = missing.examples.flatMap((example) =>
    example.name === undefined ? [] : [example.name],
  );
  if (named.length === 0) return "";
  return ` (${missing.count > named.length ? "such as " : ""}${quoteItems(named)})`;
}

/** The sections and the message for one set of records that lack a linking name. */
function incompleteNameText(
  missing: MissingNameField,
  context: MergeContext,
): { readonly sections: readonly SectionId[]; readonly message: string } {
  switch (missing.part) {
    case "specimenInfo": {
      const sections: readonly SectionId[] = ["specimens", "project"];
      const ask = `There are ${countText(context.projects, "project")}, so each specimen needs to name its project.`;
      if (!context.specimensGiven) {
        return {
          sections,
          message: `${ask} Add a specimen table with a project name column on the Specimens step.`,
        };
      }
      if (missing.count === context.specimens) {
        return {
          sections,
          message: `${ask} Choose the project name column of the specimen table, and fill it in for every specimen.`,
        };
      }
      return {
        sections,
        message: `Projects are entered, but ${countText(missing.count, "specimen")} ${missing.count === 1 ? "has" : "have"} no project name${examplesText(missing)}. Fill in the project name column of the specimen table in every row.`,
      };
    }
    case "librarySampleInfo": {
      const sections: readonly SectionId[] = ["librarySamples", "sequencing"];
      const ask = `There are ${countText(context.sequencingRuns, "sequencing run")}, so each library sample needs to name its run.`;
      if (!context.librarySamplesGiven) {
        return {
          sections,
          message: `${ask} Add a library sample table with a sequencing run name column on the Library samples step.`,
        };
      }
      if (missing.count === context.librarySamples) {
        return {
          sections,
          message: `${ask} Choose the sequencing run name column of the library sample table, and fill it in for every library sample.`,
        };
      }
      return {
        sections,
        message: `Sequencing runs are entered, but ${countText(missing.count, "library sample")} ${missing.count === 1 ? "has" : "have"} no sequencing run name${examplesText(missing)}. Fill in the sequencing run name column of the library sample table in every row.`,
      };
    }
    case "mhapInfo":
      return {
        sections: ["microhaplotypes", "bioinformatics"],
        message:
          "Bioinformatics runs are entered, but the allele table gives no run name. Set the run name on the Microhaplotypes step.",
      };
    case "readCountsByStageInfo":
      return {
        sections: ["readCounts", "bioinformatics"],
        message:
          "Bioinformatics runs are entered, but the read counts give no run name. Set the run name on the Read counts step.",
      };
    default:
      return unreachable(missing.part);
  }
}

function mergeErrorNotices(error: unknown, context: MergeContext): Notice[] {
  if (!(error instanceof PmoError)) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      draftNotice(
        {
          severity: "error",
          code: "build/unexpected",
          message: withLibraryDetail(
            "Something went wrong while putting the steps together into one PMO. Check the results on each step for problems, then try again.",
            message,
          ),
        },
        [],
      ),
    ];
  }
  const { code, details } = error;
  switch (code) {
    case "merge/unresolved-names": {
      const notices: Notice[] = [];
      for (const [kind, value] of Object.entries(details)) {
        const list = Array.isArray(value) ? value.map((item: unknown) => String(item)) : [];
        if (list.length === 0) continue;
        const text = unresolvedText(kind, quoteItems(list), context);
        notices.push(
          draftNotice(
            {
              severity: "error",
              code,
              message:
                text?.message ??
                withLibraryDetail(
                  `Some names in one table do not match the names in another (${quoteItems(list)}). Check that each name is spelled the same way in every table that uses it.`,
                  `${kind}: ${quoteItems(list)}`,
                ),
            },
            text?.sections ?? [],
          ),
        );
      }
      return notices;
    }
    case "merge/incomplete-name-fields": {
      const missing = missingNameFields(details);
      if (missing.length === 0) {
        return [
          draftNotice(
            {
              severity: "error",
              code,
              message: withLibraryDetail(
                "Some records are missing a name that links them to another step. Fill in the name columns in every row of the tables involved.",
                error.message,
              ),
            },
            [],
          ),
        ];
      }
      return missing.map((entry) => {
        const text = incompleteNameText(entry, context);
        return draftNotice({ severity: "error", code, message: text.message }, text.sections);
      });
    }
    case "merge/runs-without-methods":
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message:
              "Bioinformatics runs are entered, but no method. Add the method the runs used on the Bioinformatics step.",
          },
          ["bioinformatics"],
        ),
      ];
    case "merge/several-panels-without-sample-info":
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message:
              "There are several panels, so a library sample table is needed to say which panel each sample used. Add one on the Library samples step, or use a single panel.",
          },
          ["panel", "librarySamples"],
        ),
      ];
    case "merge/duplicate-library-sample-names":
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message: `These samples appear more than once in one run of the allele table: ${quoteItems(names(details, "names"))}.`,
          },
          ["microhaplotypes"],
        ),
      ];
    default:
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message: withLibraryDetail(
              "The steps could not be put together into one PMO. Check that names match between tables (samples, targets, runs), then look at the results on each step.",
              error.message,
            ),
          },
          [],
        ),
      ];
  }
}

function mergeWarningNotice(warning: PmoWarning): Notice {
  const list = quoteItems(names(warning.details, "names"));
  switch (warning.code) {
    case "merge/specimens-added":
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: `These samples in the allele table are not in the specimen table, so they were added with no details: ${list}.`,
        },
        ["microhaplotypes", "specimens"],
      );
    case "merge/specimens-without-library-samples":
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: `These specimens are in the specimen table but have no results in the allele table: ${list}.`,
        },
        ["specimens", "microhaplotypes"],
      );
    default:
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: withLibraryDetail(
            "Something to check came up while putting the steps together into one PMO. The PMO was still made.",
            warning.message,
          ),
        },
        [],
      );
  }
}

const TOP_LEVEL: Readonly<
  Record<string, { readonly section: SectionId; readonly noun: string; readonly nameKey: string }>
> = {
  specimen_info: { section: "specimens", noun: "Specimen", nameKey: "specimen_name" },
  library_sample_info: {
    section: "librarySamples",
    noun: "Library sample",
    nameKey: "library_sample_name",
  },
  panel_info: { section: "panel", noun: "Panel", nameKey: "panel_name" },
  target_info: { section: "panel", noun: "Target", nameKey: "target_name" },
  targeted_genomes: { section: "panel", noun: "Genome", nameKey: "name" },
  project_info: { section: "project", noun: "Project", nameKey: "project_name" },
  sequencing_info: {
    section: "sequencing",
    noun: "Sequencing run",
    nameKey: "sequencing_info_name",
  },
  bioinformatics_methods_info: {
    section: "bioinformatics",
    noun: "Method",
    nameKey: "bioinformatics_method_name",
  },
  bioinformatics_run_info: {
    section: "bioinformatics",
    noun: "Bioinformatics run",
    nameKey: "bioinformatics_run_name",
  },
  representative_microhaplotypes: {
    section: "microhaplotypes",
    noun: "Microhaplotypes",
    nameKey: "",
  },
  detected_microhaplotypes: {
    section: "microhaplotypes",
    noun: "Detected microhaplotypes",
    nameKey: "",
  },
  read_counts_by_stage: { section: "readCounts", noun: "Read counts", nameKey: "" },
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** "Specimen "S1", collection_country", from a path into the PMO. */
function describeLocation(
  pmo: PortableMicrohaplotypeObject,
  path: readonly PathSegment[],
): {
  readonly sections: readonly SectionId[];
  readonly where: string;
} {
  const [top, index, ...rest] = path;
  const info = typeof top === "string" ? TOP_LEVEL[top] : undefined;
  if (info === undefined) return { sections: [], where: `In the PMO, ${pathInWords(path)}` };
  let where = info.noun;
  if (typeof index === "number") {
    const list = pmo[String(top)];
    const record: unknown = Array.isArray(list) ? list[index] : undefined;
    const name = isRecord(record) && info.nameKey !== "" ? record[info.nameKey] : undefined;
    where = typeof name === "string" ? `${info.noun} "${name}"` : `${info.noun} ${index + 1}`;
  } else if (index !== undefined) {
    rest.unshift(index);
  }
  return {
    sections: [info.section],
    where: rest.length > 0 ? `${where}, ${pathInWords(rest)}` : where,
  };
}

/**
 * The rest of a path into a record, in words: `target 1, microhaplotype 3,
 * field "seq"`. A list name followed by a position becomes the singular and
 * a count from 1; the last name is the field.
 */
export function pathInWords(path: readonly PathSegment[]): string {
  const parts: string[] = [];
  for (let index = 0; index < path.length; index += 1) {
    const segment = path[index];
    const next = path[index + 1];
    if (typeof segment === "string" && typeof next === "number") {
      const noun = segment.replaceAll("_", " ").replace(/s$/, "");
      parts.push(`${noun} ${next + 1}`);
      index += 1;
    } else if (typeof segment === "string") {
      parts.push(index === path.length - 1 ? `field "${segment}"` : segment.replaceAll("_", " "));
    } else if (typeof segment === "number") {
      parts.push(`item ${segment + 1}`);
    }
  }
  return parts.join(", ");
}

function paramText(value: unknown, fallback: string): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((item: unknown) => String(item)).join(" or ");
  return fallback;
}

/** Schema errors at one place in the PMO, in the order the validator found them. */
interface SchemaErrorGroup {
  readonly path: readonly PathSegment[];
  readonly instancePath: string;
  readonly errors: readonly [SchemaValidationError, ...SchemaValidationError[]];
}

/**
 * Groups schema errors by where they are, so one bad cell that fails two
 * rules (its type and its pattern, say) is one problem. Groups keep the order
 * of their first error.
 */
function groupByPath(errors: readonly SchemaValidationError[]): readonly SchemaErrorGroup[] {
  const groups = new Map<string, SchemaErrorGroup>();
  for (const error of errors) {
    const group = groups.get(error.instancePath);
    groups.set(
      error.instancePath,
      group === undefined
        ? { path: error.path, instancePath: error.instancePath, errors: [error] }
        : { ...group, errors: [...group.errors, error] },
    );
  }
  return [...groups.values()];
}

/** What is wrong, to follow "it": "should be integer". `null` for a rule without its own words. */
function schemaReason(error: SchemaValidationError): string | null {
  switch (error.keyword) {
    case "pattern":
      return "has characters the PMO format does not allow there";
    case "required":
      return `is missing ${paramText(error.params["missingProperty"], "a required field")}`;
    case "type":
      return `should be ${paramText(error.params["type"], "another type")}`;
    default:
      return null;
  }
}

function valueText(value: unknown): string {
  return typeof value === "string" ? `"${value}"` : JSON.stringify(value);
}

/** The message for one schema error, as a whole sentence. */
function oneSchemaMessage(
  error: SchemaValidationError,
  where: string,
  sections: readonly SectionId[],
): string {
  const value = valueText(error.value);
  if ((error.keyword === "pattern" || error.keyword === "minLength") && error.value === "") {
    return `${where} is blank. The PMO format needs a value there.`;
  }
  switch (error.keyword) {
    case "pattern":
      return `${where} is ${value}, which has characters the PMO format does not allow there.`;
    case "required":
      return `${where} is missing ${paramText(error.params["missingProperty"], "a required field")}.`;
    case "type":
      return `${where} should be ${paramText(error.params["type"], "another type")}, but is ${value}.`;
    default:
      return withLibraryDetail(
        `${where} does not match the PMO format.${
          sections[0] === undefined ? "" : ` Check it on the ${SECTION_LABELS[sections[0]]} step.`
        }`,
        error.message,
      );
  }
}

/**
 * One notice for every schema error at one place: the first error's code,
 * the path, and each reason in turn.
 */
function schemaNotice(group: SchemaErrorGroup, pmo: PortableMicrohaplotypeObject): Notice {
  const { sections, where } = describeLocation(pmo, group.path);
  const [first, ...others] = group.errors;
  let message: string;
  if (others.length === 0) {
    message = oneSchemaMessage(first, where, sections);
  } else {
    const reasons = group.errors.map(
      (error) => schemaReason(error) ?? "does not match the PMO format",
    );
    const unworded = group.errors.filter((error) => schemaReason(error) === null);
    const head = group.errors.every((error) => error.keyword === "required")
      ? where
      : `${where} is ${valueText(first.value)}`;
    message = withLibraryDetail(
      `${head}. It ${[...new Set(reasons)].join(", and it ")}.`,
      unworded.map((error) => error.message).join(" "),
    );
  }
  return {
    ...draftNotice({ severity: "error", code: `schema/${first.keyword}`, message }, sections),
    path: group.instancePath,
  };
}

function integrityNotice(issue: IntegrityIssue): Notice {
  const top = issue.path[0];
  const info = typeof top === "string" ? TOP_LEVEL[top] : undefined;
  const count = issue.omitted === undefined ? "" : ` (and ${issue.omitted} more like it)`;
  const where =
    info === undefined
      ? "The PMO has a problem in how its parts refer to each other."
      : `${info.noun} records in the PMO have a problem. Check the ${SECTION_LABELS[info.section]} step.`;
  return draftNotice(
    {
      severity: issue.severity,
      code: issue.code,
      message: withLibraryDetail(where, `${issue.message}${count}`),
    },
    info === undefined ? [] : [info.section],
  );
}

/** Counts what a PMO holds, for the review step. */
export function summarisePmo(pmo: PortableMicrohaplotypeObject): MergeSummary {
  const detectedSamples = new Set<number>();
  const calledTargets = new Set<number>();
  const representative = pmo.representative_microhaplotypes.targets;
  for (const run of pmo.detected_microhaplotypes) {
    for (const sample of run.library_samples) {
      detectedSamples.add(sample.library_sample_id);
      for (const result of sample.target_results) {
        const target = representative[result.mhaps_target_id];
        if (target !== undefined) calledTargets.add(target.target_id);
      }
    }
  }
  const countedSamples = new Set<number>();
  for (const run of pmo.read_counts_by_stage ?? []) {
    for (const sample of run.read_counts_by_library_sample_by_stage)
      countedSamples.add(sample.library_sample_id);
  }
  return {
    specimens: pmo.specimen_info.length,
    librarySamples: pmo.library_sample_info.length,
    librarySamplesWithDetections: detectedSamples.size,
    panels: pmo.panel_info.length,
    targets: pmo.target_info.length,
    targetsWithCalls: calledTargets.size,
    genomes: pmo.targeted_genomes?.length ?? 0,
    sequencingRuns: pmo.sequencing_info?.length ?? 0,
    projects: pmo.project_info?.length ?? 0,
    bioinformaticsRuns: pmo.bioinformatics_run_info?.length ?? 0,
    librarySamplesWithReadCounts: countedSamples.size,
  };
}
