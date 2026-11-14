/**
 * The panel section: one or more panels, each from a target table (with an
 * optional genome) or from the saved-panel library, merged with
 * `mergePanelInfoDicts` when there are several.
 */
import {
  collectWarnings,
  mergePanelInfoDicts,
  panelInfoTableToPmo,
  PmoError,
  type GenomeInfoInput,
  type PanelInfoFragment,
  type PanelInfoOptions,
  type PmoWarning,
} from "pmotools-ts";

import {
  GENOME_FORM_FIELDS,
  panelContentKey,
  panelLabel,
  readFieldValue,
  type GenomeChoice,
  type PanelDraft,
  type PanelEntry,
  unreachable,
} from "@/domain/draft";
import type { Notice, SectionStatus } from "@/domain/types";

import type { BuildContext } from "./context";
import { makeNotice, quoteItems, withLibraryDetail } from "./notices";
import {
  checkRecords,
  enteredFromTable,
  fromForms,
  writeRecord,
  requiredText,
  type CheckedRecord,
} from "./records";
import {
  notReady,
  ready,
  runBuilder,
  worstStatus,
  type PanelEntrySummary,
  type SectionResult,
} from "./results";
import { columnOptions, prepareTable, unknownKeysNotice } from "./table";

/** Builder options that name a column of the target table. */
export const PANEL_COLUMN_OPTIONS = [
  "targetNameCol",
  "forwardPrimersSeqCol",
  "reversePrimersSeqCol",
  "reactionNameCol",
  "forwardPrimersStartCol",
  "forwardPrimersEndCol",
  "reversePrimersStartCol",
  "reversePrimersEndCol",
  "insertStartCol",
  "insertEndCol",
  "chromCol",
  "strandCol",
  "refSeqCol",
  "geneNameCol",
  "genomeIdCol",
  "targetAttributesCol",
] as const satisfies readonly (keyof PanelInfoOptions)[];

const PANEL_NAME_FIELD = {
  key: "panel_name",
  label: "Panel name",
  description: "",
  required: true,
  kind: "text",
  format: { pattern: /^[A-z\-._0-9]+$/, hint: "letters, numbers and . _ - (no spaces)" },
  example: "",
} as const;

type EntryResult =
  | { readonly kind: "empty" }
  | {
      readonly kind: "built";
      readonly name: string;
      readonly fragment: PanelInfoFragment;
      readonly notices: readonly Notice[];
    }
  | {
      readonly kind: "blocked";
      readonly status: "incomplete" | "error";
      readonly notices: readonly Notice[];
    };

function isEntryEmpty(entry: PanelEntry): boolean {
  if (entry.source === "saved") return entry.saved === null;
  return entry.name.trim() === "" && entry.table === null && entry.genome.mode === "none";
}

/** Puts the panel's label in front of each message and points each notice at the panel. */
function prefix(entry: PanelEntry, label: string, notices: readonly Notice[]): Notice[] {
  return notices.map((notice) => ({
    ...notice,
    message: `${label}: ${notice.message}`,
    panelId: entry.id,
  }));
}

/** Checks a panel name typed by the user. */
function checkName(
  name: string,
):
  | { readonly kind: "ok"; readonly name: string }
  | { readonly kind: "blocked"; readonly status: "incomplete" | "error"; readonly notice: Notice } {
  const value = readFieldValue(PANEL_NAME_FIELD, name, "form");
  if (value.kind === "text") return { kind: "ok", name: value.value };
  if (value.kind === "invalid")
    return {
      kind: "blocked",
      status: "error",
      notice: makeNotice("error", "panel/invalid-name", value.message),
    };
  return {
    kind: "blocked",
    status: "incomplete",
    notice: makeNotice("error", "panel/missing-name", "Give the panel a name."),
  };
}

/**
 * The saved fragment under the name the panel goes by in this draft. A saved
 * panel can be renamed in the draft, so that it matches the panel name the
 * library sample table uses; the saved copy keeps its own name.
 */
function renamed(fragment: PanelInfoFragment, name: string): PanelInfoFragment {
  const [first, ...rest] = fragment.panel_info;
  if (first === undefined || rest.length > 0 || first.panel_name === name) return fragment;
  return { ...fragment, panel_info: [{ ...first, panel_name: name }] };
}

type GenomeResult =
  | { readonly kind: "ok"; readonly genomes: readonly GenomeInfoInput[] | null }
  | {
      readonly kind: "blocked";
      readonly status: "incomplete" | "error";
      readonly notices: readonly Notice[];
    };

type GenomeKey = (typeof GENOME_FORM_FIELDS)[number]["key"];

function toGenome(record: CheckedRecord<GenomeKey>): GenomeInfoInput {
  const taxon = record.values.get("taxon_id");
  const genome: Record<string, unknown> = {
    name: requiredText(record, "name"),
    genome_version: requiredText(record, "genome_version"),
    taxon_id: Array.isArray(taxon) ? taxon : [],
    url: requiredText(record, "url"),
  };
  writeRecord(genome, record);
  return genome;
}

function buildGenome(genome: GenomeChoice, context: BuildContext): GenomeResult {
  switch (genome.mode) {
    case "none":
      return { kind: "ok", genomes: null };
    case "manual": {
      const checked = checkRecords(GENOME_FORM_FIELDS, fromForms([genome.manual], "Genome"));
      if (checked.status === "empty") {
        return {
          kind: "blocked",
          status: "incomplete",
          notices: [
            makeNotice("error", "genome/missing", "Fill in the genome, or choose no genome."),
          ],
        };
      }
      if (checked.status !== "ready")
        return { kind: "blocked", status: checked.status, notices: checked.notices };
      return { kind: "ok", genomes: checked.records.map(toGenome) };
    }
    case "table": {
      const entered = enteredFromTable(
        {
          fields: GENOME_FORM_FIELDS,
          mapped: genome.table,
          fieldSetId: "genomes",
          tableLabel: "genome table",
        },
        context,
      );
      if (entered.kind === "blocked") {
        if (entered.status === "empty") {
          return {
            kind: "blocked",
            status: "incomplete",
            notices: [
              makeNotice(
                "error",
                "genome/missing",
                "Import the genome table, or choose no genome.",
              ),
            ],
          };
        }
        return { kind: "blocked", status: entered.status, notices: entered.notices };
      }
      const checked = checkRecords(GENOME_FORM_FIELDS, entered.records);
      if (checked.status === "empty") {
        return {
          kind: "blocked",
          status: "incomplete",
          notices: [
            makeNotice("error", "table/no-rows", "The genome table has no rows with values."),
          ],
        };
      }
      if (checked.status !== "ready")
        return { kind: "blocked", status: checked.status, notices: checked.notices };
      return { kind: "ok", genomes: checked.records.map(toGenome) };
    }
    default:
      return unreachable(genome.mode);
  }
}

function buildEntry(entry: PanelEntry, context: BuildContext): EntryResult {
  if (isEntryEmpty(entry)) return { kind: "empty" };
  if (entry.source === "saved") {
    const saved = entry.saved;
    if (saved === null) {
      return {
        kind: "blocked",
        status: "incomplete",
        notices: [makeNotice("error", "panel/no-saved-panel", "Choose a saved panel.")],
      };
    }
    // Checks the stored fragment the same way a merge would, and returns a clean copy.
    let checkedSaved: PanelInfoFragment;
    let savedWarnings: readonly PmoWarning[];
    try {
      const { result, warnings } = collectWarnings((onWarning) =>
        mergePanelInfoDicts([saved.fragment], { onWarning }),
      );
      checkedSaved = result;
      savedWarnings = warnings;
    } catch (error) {
      return {
        kind: "blocked",
        status: "error",
        notices: [
          makeNotice(
            "error",
            error instanceof PmoError ? error.code : "build/unexpected",
            withLibraryDetail(
              `The saved panel "${saved.name}" is damaged or was saved by an older version, so it cannot be used. Choose "From a target table", import the panel's target table again, and save it to the library again.`,
              error instanceof Error ? error.message : String(error),
            ),
          ),
        ],
      };
    }
    const run = {
      result: checkedSaved,
      notices: savedWarnings.map((warning) =>
        makeNotice(
          "warning",
          warning.code,
          withLibraryDetail(
            `The saved panel "${saved.name}" has something to check. If it looks wrong, build the panel again from its target table.`,
            warning.message,
          ),
        ),
      ),
    };
    const checkedName = checkName(saved.name);
    if (checkedName.kind === "blocked") {
      return {
        kind: "blocked",
        status: checkedName.status,
        notices: [checkedName.notice, ...run.notices],
      };
    }
    return {
      kind: "built",
      name: checkedName.name,
      fragment: renamed(run.result, checkedName.name),
      notices: run.notices,
    };
  }

  const notices: Notice[] = [];
  let status: SectionStatus = "ready";
  const nameValue = checkName(entry.name);
  if (nameValue.kind === "blocked") {
    notices.push(nameValue.notice);
    status = nameValue.status;
  }
  const genome = buildGenome(entry.genome, context);
  if (genome.kind === "blocked") {
    notices.push(...genome.notices);
    status = worstStatus([status, genome.status]);
  }
  if (entry.table === null) {
    notices.push(makeNotice("error", "table/not-imported", "Import the target table."));
    status = worstStatus([status, "incomplete"]);
    return { kind: "blocked", status: status === "error" ? "error" : "incomplete", notices };
  }
  const tableLabel = "target table";
  const prepared = prepareTable(
    { mapped: entry.table, fieldSetId: "panelTargets", tableLabel },
    context,
  );
  if (prepared.kind === "blocked") {
    notices.push(...prepared.notices);
    status = worstStatus([status, prepared.status]);
  }
  if (
    prepared.kind === "blocked" ||
    genome.kind === "blocked" ||
    status !== "ready" ||
    nameValue.kind !== "ok"
  ) {
    return { kind: "blocked", status: status === "error" ? "error" : "incomplete", notices };
  }
  const { options, unknownKeys } = columnOptions(prepared.columns, PANEL_COLUMN_OPTIONS);
  const genomes = genome.genomes;
  const run = runBuilder(prepared.issues, (onWarning) =>
    panelInfoTableToPmo(prepared.typed, {
      ...options,
      panelName: nameValue.name,
      ...(genomes === null ? {} : { genomeInfo: genomes.length === 1 ? genomes[0] : genomes }),
      ...(prepared.additionalColumns.length > 0
        ? { additionalTargetInfoCols: prepared.additionalColumns }
        : {}),
      onWarning,
    }),
  );
  const all = [...unknownKeysNotice(unknownKeys, tableLabel), ...run.notices];
  if (!run.ok) return { kind: "blocked", status: "error", notices: all };
  return { kind: "built", name: nameValue.name, fragment: run.result, notices: all };
}

/**
 * Builds the panel section.
 *
 * - `empty`: no panel has anything entered.
 * - `incomplete`: a panel lacks its name, target table, required mapping or
 *   genome details, or an extra panel was added and left empty.
 * - `error`: a panel fails to build, two panels share a name, or merging fails.
 *
 * Notices about one panel start with its label and carry its `panelId`.
 */
export function buildPanel(section: PanelDraft, context: BuildContext): SectionResult<"panel"> {
  const entries = section.panels;
  if (entries.every(isEntryEmpty)) return notReady("panel", "empty");

  const notices: Notice[] = [];
  const statuses: SectionStatus[] = [];
  const built: { entry: PanelEntry; name: string; fragment: PanelInfoFragment }[] = [];
  entries.forEach((entry, index) => {
    const label = panelLabel(entry, index);
    const result = buildEntry(entry, context);
    switch (result.kind) {
      case "empty":
        notices.push(
          makeNotice(
            "error",
            "panel/empty",
            `${label} is empty. Import its target table or remove it.`,
            { panelId: entry.id },
          ),
        );
        statuses.push("incomplete");
        break;
      case "blocked":
        notices.push(...prefix(entry, label, result.notices));
        statuses.push(result.status);
        break;
      case "built":
        notices.push(...prefix(entry, label, result.notices));
        built.push({ entry, name: result.name, fragment: result.fragment });
        break;
    }
  });

  const names = built.map((item) => item.name);
  const repeated = names.filter((name, index) => names.indexOf(name) !== index);
  if (repeated.length > 0) {
    notices.push(
      makeNotice(
        "error",
        "panel/duplicate-panel-names",
        `Each panel needs its own name, but ${quoteItems([...new Set(repeated)])} is used more than once.`,
      ),
    );
    statuses.push("error");
  }
  const status = worstStatus(statuses);
  if (status === "error" || status === "incomplete") return notReady("panel", status, notices);

  let merged: PanelInfoFragment;
  const first = built[0];
  if (built.length === 1 && first !== undefined) {
    merged = first.fragment;
  } else {
    try {
      const { result, warnings } = collectWarnings((onWarning) =>
        mergePanelInfoDicts(
          built.map((item) => item.fragment),
          { onWarning },
        ),
      );
      merged = result;
      for (const warning of warnings) {
        const index = warning.details["panel"];
        const target = warning.details["target"];
        const source = typeof index === "number" ? built[index] : undefined;
        const panelName = source?.name;
        notices.push(
          makeNotice(
            "warning",
            warning.code,
            warning.code === "panel/conflicting-target-definition" && panelName !== undefined
              ? `Target "${String(target)}" is defined differently in panel "${panelName}" than in an earlier panel. The first definition is kept.`
              : withLibraryDetail(
                  "Something differs between the panels. Check that targets shared by two panels have the same primers and location in both.",
                  warning.message,
                ),
            source === undefined ? {} : { panelId: source.entry.id },
          ),
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notices.push(
        makeNotice(
          "error",
          error instanceof PmoError ? error.code : "build/unexpected",
          withLibraryDetail(
            "The panels could not be combined into one. Check that each target appears with the same primers and location in every panel that has it, or remove the extra panel.",
            message,
          ),
        ),
      );
      return notReady("panel", "error", notices);
    }
  }

  const byPanel: Record<string, PanelInfoFragment> = {};
  const panels: PanelEntrySummary[] = built.map(({ entry, name, fragment }) => {
    byPanel[entry.id] = fragment;
    return {
      id: entry.id,
      name,
      targets: fragment.target_info.length,
      genomes: fragment.targeted_genomes?.length ?? 0,
      contentKey: panelContentKey(fragment),
    };
  });
  return ready(
    "panel",
    { merged, byPanel },
    { panels, targets: merged.target_info.length, genomes: merged.targeted_genomes?.length ?? 0 },
    notices,
  );
}
