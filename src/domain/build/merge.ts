/**
 * Building a whole draft: every section, then `mergeToPmo`, `validatePmo` and
 * `checkPmoIntegrity`, with a merge summary and notices that name the
 * sections involved.
 */
import { plural, select, t } from "@lingui/core/macro";
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
import { listAlternatives, listItems, makeNotice, quoteItems, withLibraryDetail } from "./notices";
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
  microhaplotypes: t({ message: "Microhaplotypes", comment: "The name of a step of the app" }),
  panel: t({ message: "Panel", comment: "The name of a step of the app" }),
  specimens: t({ message: "Specimens", comment: "The name of a step of the app" }),
  librarySamples: t({ message: "Library samples", comment: "The name of a step of the app" }),
  project: t({ message: "Project", comment: "The name of a step of the app" }),
  sequencing: t({ message: "Sequencing", comment: "The name of a step of the app" }),
  bioinformatics: t({ message: "Bioinformatics", comment: "The name of a step of the app" }),
  readCounts: t({ message: "Read counts", comment: "The name of a step of the app" }),
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

/** What to say when a required section is not finished. */
const REQUIRED_MESSAGES: Readonly<Record<(typeof REQUIRED_SECTION_IDS)[number], string>> = {
  microhaplotypes: t`Microhaplotypes is needed and is not finished yet. Import the allele table on the Microhaplotypes step.`,
  panel: t`Panel is needed and is not finished yet. Add the panel's target table on the Panel step.`,
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
            message: REQUIRED_MESSAGES[id],
          },
          [id],
        ),
      );
    }
  }
  if (withErrors.length > 0) {
    const sections = listItems(withErrors.map((id) => SECTION_LABELS[id]));
    notices.push(
      draftNotice(
        {
          severity: "error",
          code: "draft/section-errors",
          message: t({
            message: `Fix the problems in ${sections} before the PMO can be built.`,
            comment:
              "{sections} is a list of step names, such as 'Panel and Specimens'. They are names: if your language needs an article or agreement, write it as 'the steps {sections}'.",
          }),
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
      const section = SECTION_LABELS[id];
      notices.push(
        draftNotice(
          {
            severity: "warning",
            code: "draft/section-left-out",
            message: t({
              message: `${section} is not finished, so it is left out of the PMO.`,
              comment:
                "{section} is the name of a step, such as 'Specimens'. It is a name: if your language needs an article or agreement, write it as 'the {section} step'.",
            }),
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
          message: plural(panelCount, {
            one: `There is # panel but no library sample table, so every sample is put on panel "${firstPanel}". Add a library sample table to say which panel each sample used.`,
            other: `There are # panels but no library sample table, so every sample is put on panel "${firstPanel}". Add a library sample table to say which panel each sample used.`,
          }),
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
            message: t`Without a specimen table, each library sample becomes its own specimen, so the specimen names in the library sample table are not used. Add a specimen table to keep them.`,
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
      const project = oneProject.project_name;
      const specimenCount = pmo.specimen_info.length;
      notices.push(
        draftNotice(
          {
            severity: "info",
            code: "draft/one-project-for-all",
            message: context.specimensGiven
              ? plural(specimenCount, {
                  one: `Project "${project}" is applied to all # specimen, because the specimen table names no project.`,
                  other: `Project "${project}" is applied to all # specimens, because the specimen table names no project.`,
                })
              : plural(specimenCount, {
                  one: `Project "${project}" is applied to all # specimen, because there is no specimen table to name a project for each.`,
                  other: `Project "${project}" is applied to all # specimens, because there is no specimen table to name a project for each.`,
                }),
          },
          ["project", "specimens"],
        ),
      );
    }
    if (oneRun !== null) {
      pmo = linkRunToAll(pmo, oneRun);
      const run = oneRun.sequencing_info_name;
      const sampleCount = pmo.library_sample_info.length;
      notices.push(
        draftNotice(
          {
            severity: "info",
            code: "draft/one-run-for-all",
            message: context.librarySamplesGiven
              ? plural(sampleCount, {
                  one: `Sequencing run "${run}" is applied to all # library sample, because the library sample table names no sequencing run.`,
                  other: `Sequencing run "${run}" is applied to all # library samples, because the library sample table names no sequencing run.`,
                })
              : plural(sampleCount, {
                  one: `Sequencing run "${run}" is applied to all # library sample, because there is no library sample table to name a run for each.`,
                  other: `Sequencing run "${run}" is applied to all # library samples, because there is no library sample table to name a run for each.`,
                }),
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
            message: plural(rest, {
              one: "# more problem with the PMO format is not listed.",
              other: "# more problems with the PMO format are not listed.",
            }),
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
    const projectCount = projects.length;
    const nameList = quoteItems(projects);
    notices.push(
      draftNotice(
        {
          severity: "warning",
          code: "draft/unlinked-project-names",
          message:
            results.project.status === "empty"
              ? plural(projectCount, {
                  one: `The specimen table names the project ${nameList}, but no project is entered, so the PMO keeps the name without linking it to a project. Add the project on the Project step, or unmap the project name column.`,
                  other: `The specimen table names the projects ${nameList}, but no project is entered, so the PMO keeps the names without linking them to a project. Add the project on the Project step, or unmap the project name column.`,
                })
              : plural(projectCount, {
                  one: `The specimen table names the project ${nameList}, but the Project step is not finished, so the PMO keeps the name without linking it to a project. Add the project on the Project step, or unmap the project name column.`,
                  other: `The specimen table names the projects ${nameList}, but the Project step is not finished, so the PMO keeps the names without linking them to a project. Add the project on the Project step, or unmap the project name column.`,
                }),
        },
        ["specimens", "project"],
      ),
    );
  }
  const runs = namesIn(results.librarySamples.fragment, "sequencing_info_name");
  if (runs.length > 0 && results.sequencing.fragment === null) {
    const runCount = runs.length;
    const nameList = quoteItems(runs);
    notices.push(
      draftNotice(
        {
          severity: "warning",
          code: "draft/unlinked-sequencing-names",
          message:
            results.sequencing.status === "empty"
              ? plural(runCount, {
                  one: `The library sample table names the sequencing run ${nameList}, but no sequencing run is entered, so the PMO keeps the name without linking it to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.`,
                  other: `The library sample table names the sequencing runs ${nameList}, but no sequencing run is entered, so the PMO keeps the names without linking them to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.`,
                })
              : plural(runCount, {
                  one: `The library sample table names the sequencing run ${nameList}, but the Sequencing step is not finished, so the PMO keeps the name without linking it to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.`,
                  other: `The library sample table names the sequencing runs ${nameList}, but the Sequencing step is not finished, so the PMO keeps the names without linking them to a run. Add the run on the Sequencing step, or unmap the sequencing run name column.`,
                }),
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
  nameList: string,
  context: MergeContext,
): { readonly sections: readonly SectionId[]; readonly message: string } | null {
  switch (kind) {
    case "projects":
      return {
        sections: ["specimens", "project"],
        message: t`These project names are in the specimen table but not in the Project step: ${nameList}. Add the projects or correct the names.`,
      };
    case "sequencing":
      return {
        sections: ["librarySamples", "sequencing"],
        message: t`These sequencing run names are in the library sample table but not in the Sequencing step: ${nameList}. Add the runs or correct the names.`,
      };
    case "specimens":
      return {
        sections: ["librarySamples", "specimens"],
        message: t`These specimen names are in the library sample table but not in the specimen table: ${nameList}. Add them to the specimen table or correct the names.`,
      };
    case "panels":
      return {
        sections: ["librarySamples", "panel"],
        message: t`These panel names are in the library sample table but no panel has that name: ${nameList}. Rename the panel on the Panel step or correct the table.`,
      };
    case "targets":
      return {
        sections: ["microhaplotypes", "panel"],
        message: t`These targets are in the allele table but not in the panel: ${nameList}. Check that the panel's target table lists every target.`,
      };
    case "bioinformaticsRuns":
      return {
        sections: ["microhaplotypes", "bioinformatics"],
        message: t`These run names are in the allele table but not among the bioinformatics runs: ${nameList}. Add the runs or correct the names.`,
      };
    case "librarySamples":
      return {
        sections: ["microhaplotypes", "librarySamples"],
        message: t`These samples are in the allele table but not in the library sample table: ${nameList}. Add them to the library sample table or correct the names.`,
      };
    case "readCountsBioinformaticsRuns":
      return {
        sections: ["readCounts", "bioinformatics"],
        message: t`These run names have read counts but are not among the bioinformatics runs: ${nameList}.`,
      };
    case "readCountsLibrarySamples":
      return context.librarySamplesGiven
        ? {
            sections: ["readCounts", "librarySamples"],
            message: t`These samples have read counts but are not in the library sample table: ${nameList}.`,
          }
        : {
            sections: ["readCounts", "microhaplotypes"],
            message: t`These samples have read counts but are not in the allele table: ${nameList}.`,
          };
    case "readCountsTargets":
      return {
        sections: ["readCounts", "panel"],
        message: t`These targets have read counts but are not in the panel: ${nameList}.`,
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

/**
 * The names a set of records without a linking name gives, for quoting:
 * `none` when they give none, `all` when every such record is named, and
 * `some` when there are more records than names.
 */
function examplesOf(missing: MissingNameField): {
  readonly kind: "none" | "all" | "some";
  readonly examples: string;
} {
  const named = missing.examples.flatMap((example) =>
    example.name === undefined ? [] : [example.name],
  );
  if (named.length === 0) return { kind: "none", examples: "" };
  return { kind: missing.count > named.length ? "some" : "all", examples: quoteItems(named) };
}

/** The sections and the message for one set of records that lack a linking name. */
function incompleteNameText(
  missing: MissingNameField,
  context: MergeContext,
): { readonly sections: readonly SectionId[]; readonly message: string } {
  const missingCount = missing.count;
  const { kind, examples } = examplesOf(missing);
  switch (missing.part) {
    case "specimenInfo": {
      const sections: readonly SectionId[] = ["specimens", "project"];
      const projectCount = context.projects;
      if (!context.specimensGiven) {
        return {
          sections,
          message: plural(projectCount, {
            one: "There is # project, so each specimen needs to name its project. Add a specimen table with a project name column on the Specimens step.",
            other:
              "There are # projects, so each specimen needs to name its project. Add a specimen table with a project name column on the Specimens step.",
          }),
        };
      }
      if (missing.count === context.specimens) {
        return {
          sections,
          message: plural(projectCount, {
            one: "There is # project, so each specimen needs to name its project. Choose the project name column of the specimen table, and fill it in for every specimen.",
            other:
              "There are # projects, so each specimen needs to name its project. Choose the project name column of the specimen table, and fill it in for every specimen.",
          }),
        };
      }
      return {
        sections,
        message: t({
          message: select(kind, {
            all: plural(missingCount, {
              one: `Projects are entered, but # specimen has no project name (${examples}). Fill in the project name column of the specimen table in every row.`,
              other: `Projects are entered, but # specimens have no project name (${examples}). Fill in the project name column of the specimen table in every row.`,
            }),
            some: plural(missingCount, {
              one: `Projects are entered, but # specimen has no project name (such as ${examples}). Fill in the project name column of the specimen table in every row.`,
              other: `Projects are entered, but # specimens have no project name (such as ${examples}). Fill in the project name column of the specimen table in every row.`,
            }),
            other: plural(missingCount, {
              one: `Projects are entered, but # specimen has no project name. Fill in the project name column of the specimen table in every row.`,
              other: `Projects are entered, but # specimens have no project name. Fill in the project name column of the specimen table in every row.`,
            }),
          }),
          comment:
            "{examples} quotes some of the specimens. {kind} is 'all' when it quotes every one, 'some' when it quotes only some, and 'none' when it is empty.",
        }),
      };
    }
    case "librarySampleInfo": {
      const sections: readonly SectionId[] = ["librarySamples", "sequencing"];
      const runCount = context.sequencingRuns;
      if (!context.librarySamplesGiven) {
        return {
          sections,
          message: plural(runCount, {
            one: "There is # sequencing run, so each library sample needs to name its run. Add a library sample table with a sequencing run name column on the Library samples step.",
            other:
              "There are # sequencing runs, so each library sample needs to name its run. Add a library sample table with a sequencing run name column on the Library samples step.",
          }),
        };
      }
      if (missing.count === context.librarySamples) {
        return {
          sections,
          message: plural(runCount, {
            one: "There is # sequencing run, so each library sample needs to name its run. Choose the sequencing run name column of the library sample table, and fill it in for every library sample.",
            other:
              "There are # sequencing runs, so each library sample needs to name its run. Choose the sequencing run name column of the library sample table, and fill it in for every library sample.",
          }),
        };
      }
      return {
        sections,
        message: t({
          message: select(kind, {
            all: plural(missingCount, {
              one: `Sequencing runs are entered, but # library sample has no sequencing run name (${examples}). Fill in the sequencing run name column of the library sample table in every row.`,
              other: `Sequencing runs are entered, but # library samples have no sequencing run name (${examples}). Fill in the sequencing run name column of the library sample table in every row.`,
            }),
            some: plural(missingCount, {
              one: `Sequencing runs are entered, but # library sample has no sequencing run name (such as ${examples}). Fill in the sequencing run name column of the library sample table in every row.`,
              other: `Sequencing runs are entered, but # library samples have no sequencing run name (such as ${examples}). Fill in the sequencing run name column of the library sample table in every row.`,
            }),
            other: plural(missingCount, {
              one: `Sequencing runs are entered, but # library sample has no sequencing run name. Fill in the sequencing run name column of the library sample table in every row.`,
              other: `Sequencing runs are entered, but # library samples have no sequencing run name. Fill in the sequencing run name column of the library sample table in every row.`,
            }),
          }),
          comment:
            "{examples} quotes some of the library samples. {kind} is 'all' when it quotes every one, 'some' when it quotes only some, and 'none' when it is empty.",
        }),
      };
    }
    case "mhapInfo":
      return {
        sections: ["microhaplotypes", "bioinformatics"],
        message: t`Bioinformatics runs are entered, but the allele table gives no run name. Set the run name on the Microhaplotypes step.`,
      };
    case "readCountsByStageInfo":
      return {
        sections: ["readCounts", "bioinformatics"],
        message: t`Bioinformatics runs are entered, but the read counts give no run name. Set the run name on the Read counts step.`,
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
            t`Something went wrong while putting the steps together into one PMO. Check the results on each step for problems, then try again.`,
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
        const nameList = quoteItems(list);
        const text = unresolvedText(kind, nameList, context);
        notices.push(
          draftNotice(
            {
              severity: "error",
              code,
              message:
                text?.message ??
                withLibraryDetail(
                  t`Some names in one table do not match the names in another (${nameList}). Check that each name is spelled the same way in every table that uses it.`,
                  `${kind}: ${nameList}`,
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
                t`Some records are missing a name that links them to another step. Fill in the name columns in every row of the tables involved.`,
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
            message: t`Bioinformatics runs are entered, but no method. Add the method the runs used on the Bioinformatics step.`,
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
            message: t`There are several panels, so a library sample table is needed to say which panel each sample used. Add one on the Library samples step, or use a single panel.`,
          },
          ["panel", "librarySamples"],
        ),
      ];
    case "merge/duplicate-library-sample-names": {
      const samples = quoteItems(names(details, "names"));
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message: t`These samples appear more than once in one run of the allele table: ${samples}.`,
          },
          ["microhaplotypes"],
        ),
      ];
    }
    default:
      return [
        draftNotice(
          {
            severity: "error",
            code,
            message: withLibraryDetail(
              t`The steps could not be put together into one PMO. Check that names match between tables (samples, targets, runs), then look at the results on each step.`,
              error.message,
            ),
          },
          [],
        ),
      ];
  }
}

function mergeWarningNotice(warning: PmoWarning): Notice {
  const samples = quoteItems(names(warning.details, "names"));
  switch (warning.code) {
    case "merge/specimens-added":
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: t`These samples in the allele table are not in the specimen table, so they were added with no details: ${samples}.`,
        },
        ["microhaplotypes", "specimens"],
      );
    case "merge/specimens-without-library-samples":
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: t`These specimens are in the specimen table but have no results in the allele table: ${samples}.`,
        },
        ["specimens", "microhaplotypes"],
      );
    default:
      return draftNotice(
        {
          severity: "warning",
          code: warning.code,
          message: withLibraryDetail(
            t`Something to check came up while putting the steps together into one PMO. The PMO was still made.`,
            warning.message,
          ),
        },
        [],
      );
  }
}

/** A top-level part of the PMO: its step, how its records are named, and its integrity message. */
interface TopLevelPart {
  readonly section: SectionId;
  /** The record type, to start a place in the PMO, such as "Specimen". */
  readonly noun: string;
  readonly nameKey: string;
  /** What to say when its records do not refer to the rest of the PMO properly. */
  readonly integrity: string;
}

const TOP_LEVEL: Readonly<Record<string, TopLevelPart>> = {
  specimen_info: {
    section: "specimens",
    noun: t({
      message: "Specimen",
      comment: "A record type in the PMO, starting a place in the file, such as 'Specimen \"S1\"'.",
    }),
    nameKey: "specimen_name",
    integrity: t`Specimen records in the PMO have a problem. Check the Specimens step.`,
  },
  library_sample_info: {
    section: "librarySamples",
    noun: t({
      message: "Library sample",
      comment:
        "A record type in the PMO, starting a place in the file, such as 'Library sample \"L1\"'.",
    }),
    nameKey: "library_sample_name",
    integrity: t`Library sample records in the PMO have a problem. Check the Library samples step.`,
  },
  panel_info: {
    section: "panel",
    noun: t({
      message: "Panel",
      comment: "A record type in the PMO, starting a place in the file, such as 'Panel \"P1\"'.",
    }),
    nameKey: "panel_name",
    integrity: t`Panel records in the PMO have a problem. Check the Panel step.`,
  },
  target_info: {
    section: "panel",
    noun: t({
      message: "Target",
      comment: "A record type in the PMO, starting a place in the file, such as 'Target \"t1\"'.",
    }),
    nameKey: "target_name",
    integrity: t`Target records in the PMO have a problem. Check the Panel step.`,
  },
  targeted_genomes: {
    section: "panel",
    noun: t({
      message: "Genome",
      comment: "A record type in the PMO, starting a place in the file, such as 'Genome \"3D7\"'.",
    }),
    nameKey: "name",
    integrity: t`Genome records in the PMO have a problem. Check the Panel step.`,
  },
  project_info: {
    section: "project",
    noun: t({
      message: "Project",
      comment:
        "A record type in the PMO, starting a place in the file, such as 'Project \"Study 1\"'.",
    }),
    nameKey: "project_name",
    integrity: t`Project records in the PMO have a problem. Check the Project step.`,
  },
  sequencing_info: {
    section: "sequencing",
    noun: t({
      message: "Sequencing run",
      comment:
        "A record type in the PMO, starting a place in the file, such as 'Sequencing run \"Run 1\"'.",
    }),
    nameKey: "sequencing_info_name",
    integrity: t`Sequencing run records in the PMO have a problem. Check the Sequencing step.`,
  },
  bioinformatics_methods_info: {
    section: "bioinformatics",
    noun: t({
      message: "Method",
      comment:
        "A bioinformatics method record in the PMO, starting a place in the file, such as 'Method 1'.",
    }),
    nameKey: "bioinformatics_method_name",
    integrity: t`Method records in the PMO have a problem. Check the Bioinformatics step.`,
  },
  bioinformatics_run_info: {
    section: "bioinformatics",
    noun: t({
      message: "Bioinformatics run",
      comment:
        "A record type in the PMO, starting a place in the file, such as 'Bioinformatics run \"R1\"'.",
    }),
    nameKey: "bioinformatics_run_name",
    integrity: t`Bioinformatics run records in the PMO have a problem. Check the Bioinformatics step.`,
  },
  representative_microhaplotypes: {
    section: "microhaplotypes",
    noun: t({
      message: "Microhaplotypes",
      comment:
        "A part of the PMO, starting a place in the file, such as 'Microhaplotypes, target 1'.",
    }),
    nameKey: "",
    integrity: t`Microhaplotypes records in the PMO have a problem. Check the Microhaplotypes step.`,
  },
  detected_microhaplotypes: {
    section: "microhaplotypes",
    noun: t({
      message: "Detected microhaplotypes",
      comment:
        "A part of the PMO, starting a place in the file, such as 'Detected microhaplotypes 1'.",
    }),
    nameKey: "",
    integrity: t`Detected microhaplotypes records in the PMO have a problem. Check the Microhaplotypes step.`,
  },
  read_counts_by_stage: {
    section: "readCounts",
    noun: t({
      message: "Read counts",
      comment: "A part of the PMO, starting a place in the file, such as 'Read counts 1'.",
    }),
    nameKey: "",
    integrity: t`Read counts records in the PMO have a problem. Check the Read counts step.`,
  },
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
  if (info === undefined) {
    const place = pathInWords(path);
    return {
      sections: [],
      where: t({
        message: `In the PMO, ${place}`,
        comment:
          "A place in the PMO file, starting a sentence, such as 'In the PMO, field \"pmo_header\"'. {place} uses the PMO's own field names.",
      }),
    };
  }
  const noun = info.noun;
  let where = noun;
  if (typeof index === "number") {
    const list = pmo[String(top)];
    const record: unknown = Array.isArray(list) ? list[index] : undefined;
    const name = isRecord(record) && info.nameKey !== "" ? record[info.nameKey] : undefined;
    const position = index + 1;
    where =
      typeof name === "string"
        ? t({
            message: `${noun} "${name}"`,
            comment: "A record in the PMO, by its name, such as 'Specimen \"S1\"'.",
          })
        : t({
            message: `${noun} ${position}`,
            comment: "A record in the PMO, by its position, such as 'Specimen 3'.",
          });
  } else if (index !== undefined) {
    rest.unshift(index);
  }
  if (rest.length === 0) return { sections: [info.section], where };
  const record = where;
  const place = pathInWords(rest);
  return {
    sections: [info.section],
    where: t({
      message: `${record}, ${place}`,
      comment:
        'A place in the PMO file, such as \'Specimen "S1", field "collection_country"\'. {place} uses the PMO\'s own field names.',
    }),
  };
}

/**
 * The rest of a path into a record, in words: `target 1, microhaplotype 3,
 * field "seq"`. A list name followed by a position becomes the singular and
 * a count from 1; the last name is the field. The names are the PMO's own,
 * so only "field" and "item" are translated.
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
      parts.push(
        index === path.length - 1
          ? t({
              message: `field "${segment}"`,
              comment: "A field of the PMO, by its name in the file, such as 'field \"seq\"'.",
            })
          : segment.replaceAll("_", " "),
      );
    } else if (typeof segment === "number") {
      const position = segment + 1;
      parts.push(
        t({
          message: `item ${position}`,
          comment: "An entry of a list in the PMO, by its position, such as 'item 2'.",
        }),
      );
    }
  }
  return parts.join(", ");
}

function paramText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return listAlternatives(value.map((item: unknown) => String(item)));
  return null;
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

/** The field a `required` error names, or `null` when it names none. */
function missingField(error: SchemaValidationError): string | null {
  return paramText(error.params["missingProperty"]);
}

/** The type a `type` error asks for, or `null` when it names none. */
function expectedType(error: SchemaValidationError): string | null {
  return paramText(error.params["type"]);
}

/** What is wrong, to follow "it": "should be integer". `null` for a rule without its own words. */
function schemaReason(error: SchemaValidationError): string | null {
  switch (error.keyword) {
    case "pattern":
      return t({
        message: "has characters the PMO format does not allow there",
        comment:
          "Part of a sentence: a verb phrase that follows 'It', as in 'It has characters ...'. Several such phrases may be joined with ', and it'.",
      });
    case "required": {
      const field = missingField(error);
      if (field === null) {
        return t({
          message: "is missing a required field",
          comment:
            "Part of a sentence: a verb phrase that follows 'It', as in 'It is missing a required field'. Several such phrases may be joined with ', and it'.",
        });
      }
      return t({
        message: `is missing ${field}`,
        comment:
          "Part of a sentence: a verb phrase that follows 'It', as in 'It is missing specimen_name'. {field} is a PMO field name. Several such phrases may be joined with ', and it'.",
      });
    }
    case "type": {
      const type = expectedType(error);
      if (type === null) {
        return t({
          message: "should be another type",
          comment:
            "Part of a sentence: a verb phrase that follows 'It', as in 'It should be another type'. Several such phrases may be joined with ', and it'.",
        });
      }
      return t({
        message: `should be ${type}`,
        comment:
          "Part of a sentence: a verb phrase that follows 'It', as in 'It should be integer or null'. {type} is a PMO value type, in English. Several such phrases may be joined with ', and it'.",
      });
    }
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
    return t({
      message: `${where} is blank. The PMO format needs a value there.`,
      comment:
        '{where} is a place in the PMO, such as \'Specimen "S1", field "collection_country"\'.',
    });
  }
  switch (error.keyword) {
    case "pattern":
      return t({
        message: `${where} is ${value}, which has characters the PMO format does not allow there.`,
        comment:
          '{where} is a place in the PMO, such as \'Specimen "S1", field "collection_country"\'. {value} is the value there.',
      });
    case "required": {
      const field = missingField(error);
      if (field === null) {
        return t({
          message: `${where} is missing a required field.`,
          comment: "{where} is a place in the PMO, such as 'Specimen \"S1\"'.",
        });
      }
      return t({
        message: `${where} is missing ${field}.`,
        comment:
          "{where} is a place in the PMO, such as 'Specimen \"S1\"'. {field} is a PMO field name.",
      });
    }
    case "type": {
      const type = expectedType(error);
      if (type === null) {
        return t({
          message: `${where} should be another type, but is ${value}.`,
          comment:
            '{where} is a place in the PMO, such as \'Specimen "S1", field "host_taxon_id"\'. {value} is the value there.',
        });
      }
      return t({
        message: `${where} should be ${type}, but is ${value}.`,
        comment:
          "{where} is a place in the PMO, such as 'Specimen \"S1\", field \"host_taxon_id\"'. {type} is a PMO value type, in English, such as 'integer'. {value} is the value there.",
      });
    }
    default: {
      const section = sections[0] === undefined ? undefined : SECTION_LABELS[sections[0]];
      return withLibraryDetail(
        section === undefined
          ? t({
              message: `${where} does not match the PMO format.`,
              comment:
                '{where} is a place in the PMO, such as \'Specimen "S1", field "collection_country"\'.',
            })
          : t({
              message: `${where} does not match the PMO format. Check it on the ${section} step.`,
              comment:
                "{where} is a place in the PMO, such as 'Specimen \"S1\", field \"collection_country\"'. {section} is the name of a step, such as 'Specimens'.",
            }),
        error.message,
      );
    }
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
    const reasons = [
      ...new Set(
        group.errors.map(
          (error) =>
            schemaReason(error) ??
            t({
              message: "does not match the PMO format",
              comment:
                "Part of a sentence: a verb phrase that follows 'It', as in 'It does not match the PMO format'. Several such phrases may be joined with ', and it'.",
            }),
        ),
      ),
    ];
    const unworded = group.errors.filter((error) => schemaReason(error) === null);
    const value = valueText(first.value);
    const [firstReason = "", ...moreReasons] = reasons;
    const reasonText = moreReasons.reduce(
      (text, reason) =>
        t({
          message: `${text}, and it ${reason}`,
          comment:
            "Joins what is wrong with one value of the PMO, as in 'should be integer, and it has characters the PMO format does not allow there'. {text} and {reason} are verb phrases whose subject is the value, such as 'must be a number' or 'is missing specimen_name'; {text} may already hold several phrases joined this way. The whole follows 'It' in a sentence.",
        }),
      firstReason,
    );
    const lead = group.errors.every((error) => error.keyword === "required")
      ? t({
          message: `${where}. It ${reasonText}.`,
          comment:
            "{where} is a place in the PMO, such as 'Specimen \"S1\"'. {reasonText} says what is wrong: one or more verb phrases joined with ', and it', such as 'is missing specimen_name'.",
        })
      : t({
          message: `${where} is ${value}. It ${reasonText}.`,
          comment:
            "{where} is a place in the PMO, such as 'Specimen \"S1\", field \"host_taxon_id\"'. {value} is the value there. {reasonText} says what is wrong: one or more verb phrases joined with ', and it', such as 'should be integer'.",
        });
    message = withLibraryDetail(lead, unworded.map((error) => error.message).join(" "));
  }
  return {
    ...draftNotice({ severity: "error", code: `schema/${first.keyword}`, message }, sections),
    path: group.instancePath,
  };
}

function integrityNotice(issue: IntegrityIssue): Notice {
  const top = issue.path[0];
  const info = typeof top === "string" ? TOP_LEVEL[top] : undefined;
  const libraryMessage = issue.message;
  const omitted = issue.omitted;
  const detail =
    omitted === undefined
      ? libraryMessage
      : t({
          message: plural(omitted, {
            one: `${libraryMessage} (and # more like it)`,
            other: `${libraryMessage} (and # more like it)`,
          }),
          comment: "{libraryMessage} is a technical message from the PMO library, in English.",
        });
  const where =
    info === undefined
      ? t`The PMO has a problem in how its parts refer to each other.`
      : info.integrity;
  return draftNotice(
    {
      severity: issue.severity,
      code: issue.code,
      message: withLibraryDetail(where, detail),
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
