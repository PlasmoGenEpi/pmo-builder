/**
 * The bioinformatics section: methods (each a list of steps) and the runs
 * that used them, typed in or imported. No pmotools-ts builder exists for
 * these; the records go to `mergeToPmo` as they are.
 */
import { plural, t } from "@lingui/core/macro";
import type { BioMethod, BioinformaticsMethodInfo, BioinformaticsRunInfo } from "pmotools-ts";

import {
  METHOD_STEP_FORM_FIELDS,
  RUN_FORM_FIELDS,
  isBlankRecord,
  type BioinformaticsDraft,
  type MethodRecord,
  mappedColumns,
} from "@/domain/draft";
import type { Notice, SectionStatus } from "@/domain/types";

import type { BuildContext } from "./context";
import { describeRows, makeNotice, quoteItems } from "./notices";
import {
  checkRecords,
  duplicateNameNotices,
  enteredFromTable,
  fromForms,
  requiredText,
  rowLabel,
  writeRecord,
  type CheckedRecord,
  type EnteredRecord,
} from "./records";
import { notReady, ready, worstStatus, type MethodOption, type SectionResult } from "./results";
import { checkTable } from "./table";

type StepKey = (typeof METHOD_STEP_FORM_FIELDS)[number]["key"];
type RunKey = (typeof RUN_FORM_FIELDS)[number]["key"];

/** A built method, with the key runs refer to it by. */
interface ResolvedMethod {
  readonly key: string;
  readonly name: string;
  readonly info: BioinformaticsMethodInfo;
}

interface PartResult<T> {
  readonly status: SectionStatus;
  readonly notices: readonly Notice[];
  readonly items: readonly T[];
}

function toStep(record: CheckedRecord<StepKey>): BioMethod {
  const step: BioMethod = {
    program: requiredText(record, "program"),
    program_version: requiredText(record, "program_version"),
  };
  writeRecord(step, record);
  return step;
}

function toMethod(key: string, name: string, steps: readonly BioMethod[]): ResolvedMethod {
  const info: BioinformaticsMethodInfo = { methods: [...steps] };
  if (name !== "") info["bioinformatics_method_name"] = name;
  return { key, name, info };
}

function manualMethods(records: readonly MethodRecord[]): PartResult<ResolvedMethod> {
  const notices: Notice[] = [];
  const statuses: SectionStatus[] = [];
  const methods: ResolvedMethod[] = [];
  records.forEach((record, index) => {
    const name = record.name.trim();
    const steps = record.steps.filter((step) => !isBlankRecord(step));
    if (name === "" && steps.length === 0) return;
    const methodPosition = index + 1;
    if (steps.length === 0) {
      notices.push(
        makeNotice(
          "error",
          "bioinformatics/no-steps",
          name === ""
            ? t`Method ${methodPosition} needs at least one step.`
            : t`Method "${name}" needs at least one step.`,
        ),
      );
      statuses.push("incomplete");
      return;
    }
    const checked = checkRecords(
      METHOD_STEP_FORM_FIELDS,
      fromForms(steps, (position) =>
        name === ""
          ? t({
              message: `Method ${methodPosition}, step ${position}`,
              comment: "Starts a message about one step of a bioinformatics method.",
            })
          : t({
              message: `Method "${name}", step ${position}`,
              comment: "Starts a message about one step of a bioinformatics method.",
            }),
      ),
    );
    notices.push(...checked.notices);
    statuses.push(checked.status);
    if (checked.status === "ready")
      methods.push(toMethod(record.id, name, checked.records.map(toStep)));
  });
  notices.push(
    ...duplicateNameNotices(
      methods.map((m) => m.name).filter((n) => n !== ""),
      (repeatedNames, count) =>
        plural(count, {
          one: `Each method needs its own name, but ${repeatedNames} is used more than once.`,
          other: `Each method needs its own name, but ${repeatedNames} are used more than once.`,
        }),
    ),
  );
  if (notices.some((notice) => notice.code === "form/duplicate-name")) statuses.push("error");
  return { status: worstStatus(statuses), notices, items: methods };
}

function tableMethods(
  section: BioinformaticsDraft["methods"]["table"],
  context: BuildContext,
): PartResult<ResolvedMethod> {
  const tableLabel = t({
    message: "methods table",
    comment:
      "A table name in lower case, used inside other messages, such as 'The methods table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
  });
  const mapped = section.table;
  if (mapped === null) return { status: "empty", notices: [], items: [] };
  const group = section.groupColumn;
  if (group !== null && !mapped.table.columns.includes(group)) {
    return {
      status: "error",
      notices: [
        makeNotice(
          "error",
          "bioinformatics/unknown-group-column",
          t`The methods table has no column "${group}" to split it into methods. Choose another column.`,
        ),
      ],
      items: [],
    };
  }
  // Rows are read as text, so the table is only checked, not typed.
  const prepared = checkTable({ mapped, fieldSetId: "bioinformaticsMethods", tableLabel }, context);
  if (prepared.kind === "blocked")
    return { status: prepared.status, notices: prepared.notices, items: [] };
  const entered = enteredFromRows(
    prepared.raw.rows,
    mapped.mapping.additionalColumns,
    mappedColumns(mapped),
    group,
  );
  const notices: Notice[] = [];
  const statuses: SectionStatus[] = [];
  if (entered.blankGroupRows.length > 0) {
    const column = group ?? "";
    const rows = describeRows(entered.blankGroupRows);
    const rowCount = entered.blankGroupRows.length;
    notices.push(
      makeNotice(
        "error",
        "bioinformatics/blank-group",
        t({
          message: plural(rowCount, {
            one: `Column "${column}" names the method of each step, but it is blank in ${rows}.`,
            other: `Column "${column}" names the method of each step, but it is blank in ${rows}.`,
          }),
          comment:
            "{rows} is such as 'rows 5 and 9', without an article; {rowCount} is how many rows it lists.",
        }),
      ),
    );
    statuses.push("error");
  }
  const methods: ResolvedMethod[] = [];
  for (const [groupName, rows] of entered.groups) {
    const checked = checkRecords(METHOD_STEP_FORM_FIELDS, rows);
    notices.push(...checked.notices);
    statuses.push(checked.status);
    if (checked.status === "ready") {
      const name = group === null ? "" : groupName;
      methods.push(toMethod(`table:${groupName}`, name, checked.records.map(toStep)));
    }
  }
  if (methods.length === 0 && statuses.every((s) => s === "empty")) {
    return {
      status: "incomplete",
      notices: [
        makeNotice("error", "table/no-rows", t`The methods table has no rows with values.`),
      ],
      items: [],
    };
  }
  return { status: worstStatus(statuses), notices, items: methods };
}

function enteredFromRows(
  rows: readonly Readonly<Record<string, string | null>>[],
  additionalColumns: readonly string[],
  columns: Readonly<Record<string, string>>,
  group: string | null,
): { groups: Map<string, EnteredRecord<StepKey>[]>; blankGroupRows: number[] } {
  const groups = new Map<string, EnteredRecord<StepKey>[]>();
  const blankGroupRows: number[] = [];
  rows.forEach((row, index) => {
    const groupValue = group === null ? "" : (row[group] ?? "").trim();
    if (group !== null && groupValue === "") {
      blankGroupRows.push(index);
      return;
    }
    const values: Partial<Record<StepKey, string | null>> = {};
    for (const field of METHOD_STEP_FORM_FIELDS) {
      const column = columns[field.key];
      if (column !== undefined) values[field.key] = row[column] ?? null;
    }
    const extra = additionalColumns.map((column) => ({ key: column, value: row[column] ?? "" }));
    const list = groups.get(groupValue) ?? [];
    list.push({ label: rowLabel(index), values, extra, origin: "table" });
    groups.set(groupValue, list);
  });
  return { groups, blankGroupRows };
}

/** A method with no name, by its place in the list, such as "Method 2". */
function unnamedMethod(position: number): string {
  return t({
    message: `Method ${position}`,
    comment: "A bioinformatics method with no name, by its place in the list.",
  });
}

type MethodLookup =
  | { readonly kind: "found"; readonly index: number }
  | { readonly kind: "missing"; readonly notice: Notice; readonly status: "incomplete" | "error" };

function findMethodByRef(
  methods: readonly ResolvedMethod[],
  ref: string | null,
  label: string,
): MethodLookup {
  if (ref === null || ref === "") {
    if (methods.length === 1) return { kind: "found", index: 0 };
    return {
      kind: "missing",
      status: "incomplete",
      notice: makeNotice(
        "error",
        methods.length === 0 ? "bioinformatics/no-methods" : "bioinformatics/no-method-chosen",
        methods.length === 0
          ? t({
              message: `${label}: add the method this run used.`,
              comment: "{label} names a run, such as 'Run 2', 'Row 5' or 'Runs table'.",
            })
          : t({
              message: `${label}: choose the method this run used.`,
              comment: "{label} names a run, such as 'Run 2', 'Row 5' or 'Runs table'.",
            }),
      ),
    };
  }
  const index = methods.findIndex((method) => method.key === ref);
  if (index >= 0) return { kind: "found", index };
  return {
    kind: "missing",
    status: "incomplete",
    notice: makeNotice(
      "error",
      "bioinformatics/method-gone",
      t({
        message: `${label}: the method chosen for this run is no longer there. Choose its method again.`,
        comment: "{label} names a run, such as 'Run 2', 'Row 5' or 'Runs table'.",
      }),
    ),
  };
}

function toRun(record: CheckedRecord<RunKey>, methodIndex: number): BioinformaticsRunInfo {
  const run: BioinformaticsRunInfo = {
    bioinformatics_run_name: requiredText(record, "bioinformatics_run_name"),
    bioinformatics_methods_id: methodIndex,
  };
  writeRecord(run, record);
  return run;
}

function manualRuns(
  section: BioinformaticsDraft["runs"],
  methods: readonly ResolvedMethod[],
): PartResult<BioinformaticsRunInfo> {
  const checked = checkRecords(
    RUN_FORM_FIELDS,
    fromForms(section.records, (position) => t`Run ${position}`),
  );
  const notices: Notice[] = [...checked.notices];
  const statuses: SectionStatus[] = [checked.status];
  const runs: BioinformaticsRunInfo[] = [];
  checked.records.forEach((record) => {
    const lookup = findMethodByRef(methods, record.source.form.methodRef, record.label);
    if (lookup.kind === "missing") {
      notices.push(lookup.notice);
      statuses.push(lookup.status);
      return;
    }
    runs.push(toRun(record, lookup.index));
  });
  return { status: worstStatus(statuses), notices, items: runs };
}

function tableRuns(
  section: BioinformaticsDraft["runs"]["table"],
  methods: readonly ResolvedMethod[],
  context: BuildContext,
): PartResult<BioinformaticsRunInfo> {
  const mapped = section.table;
  if (mapped === null) return { status: "empty", notices: [], items: [] };
  const methodColumn = section.methodMode === "column" ? section.methodColumn : null;
  if (
    section.methodMode === "column" &&
    (methodColumn === null || !mapped.table.columns.includes(methodColumn))
  ) {
    return {
      status: methodColumn === null ? "incomplete" : "error",
      notices: [
        makeNotice(
          "error",
          "bioinformatics/method-column",
          methodColumn === null
            ? t`Choose the column of the runs table that names each run's method.`
            : t`The runs table has no column "${methodColumn}". Choose another column for the method.`,
        ),
      ],
      items: [],
    };
  }
  const entered = enteredFromTable(
    {
      fields: RUN_FORM_FIELDS,
      mapped,
      fieldSetId: "bioinformaticsRuns",
      tableLabel: t({
        message: "runs table",
        comment:
          "The table of bioinformatics runs: a table name in lower case, used inside other messages, such as 'The runs table has no rows.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
      }),
    },
    context,
  );
  if (entered.kind === "blocked")
    return { status: entered.status, notices: entered.notices, items: [] };
  const lookup = context.tables(mapped.table.id);
  const rows = lookup.kind === "ready" ? lookup.table.rows : [];
  const checked = checkRecords(RUN_FORM_FIELDS, entered.records);
  const notices: Notice[] = [...checked.notices];
  const statuses: SectionStatus[] = [checked.status];
  const runs: BioinformaticsRunInfo[] = [];
  const unknownMethods = new Set<string>();
  const shared =
    methodColumn === null
      ? findMethodByRef(
          methods,
          section.methodRef,
          t({
            message: "Runs table",
            comment:
              "A table name, capitalised to start a message about every run of the runs table, such as 'Runs table: choose the method this run used.' French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
          }),
        )
      : null;
  if (shared !== null && shared.kind === "missing") {
    return { status: shared.status, notices: [...notices, shared.notice], items: [] };
  }
  checked.records.forEach((record) => {
    const rowIndex = record.source.rowIndex;
    let methodIndex = shared?.kind === "found" ? shared.index : -1;
    if (methodColumn !== null) {
      const value = (rows[rowIndex]?.[methodColumn] ?? "").trim();
      methodIndex = methods.findIndex((method) => method.name === value);
      if (methodIndex < 0) {
        unknownMethods.add(value);
        return;
      }
    }
    runs.push(toRun(record, methodIndex));
  });
  if (unknownMethods.size > 0) {
    const column = methodColumn ?? "";
    const unknown = quoteItems([...unknownMethods]);
    const known = quoteItems(methods.map((m) => m.name));
    notices.push(
      makeNotice(
        "error",
        "bioinformatics/unknown-method",
        t({
          message: `Column "${column}" names methods that are not in the methods: ${unknown}. The method names are ${known}.`,
          comment: "{unknown} and {known} are lists of quoted method names.",
        }),
      ),
    );
    statuses.push("error");
  }
  return { status: worstStatus(statuses), notices, items: runs };
}

/**
 * Builds the bioinformatics section from its methods and runs.
 *
 * - `empty`: no method and no run entered.
 * - `incomplete`: a step lacks its program or version, a run lacks a name or
 *   a method, or runs were entered without any method.
 * - `error`: a value the schema would reject, a repeated name, or a run
 *   naming a method that does not exist.
 *
 * The summary lists the methods (with the key a run uses to refer to one)
 * whenever they build, even while the runs are unfinished.
 */
export function buildBioinformatics(
  section: BioinformaticsDraft,
  context: BuildContext,
): SectionResult<"bioinformatics"> {
  const methods =
    section.methods.mode === "manual"
      ? manualMethods(section.methods.records)
      : tableMethods(section.methods.table, context);
  const runs =
    section.runs.mode === "manual"
      ? manualRuns(section.runs, methods.items)
      : tableRuns(section.runs.table, methods.items, context);
  const runNames = runs.items.map((run) => run.bioinformatics_run_name);
  const duplicates = duplicateNameNotices(runNames, (repeatedNames, count) =>
    plural(count, {
      one: `Each run needs its own name, but ${repeatedNames} is used more than once.`,
      other: `Each run needs its own name, but ${repeatedNames} are used more than once.`,
    }),
  );
  const notices = [...methods.notices, ...runs.notices, ...duplicates];
  const status = worstStatus([
    methods.status,
    runs.status,
    duplicates.length > 0 ? "error" : "empty",
  ]);
  const options: MethodOption[] = methods.items.map((method, index) => ({
    key: method.key,
    name: method.name === "" ? unnamedMethod(index + 1) : method.name,
    steps: method.info.methods.length,
  }));
  const summary = { methods: options, runs: runs.items.length, runNames };
  if (status !== "ready") return notReady("bioinformatics", status, notices, summary);
  return ready(
    "bioinformatics",
    { methods: methods.items.map((method) => method.info), runs: runs.items },
    summary,
    notices,
  );
}
