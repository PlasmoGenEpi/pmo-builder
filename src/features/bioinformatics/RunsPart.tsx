import { PlayCircle } from "lucide-react";

import { RUN_FORM_FIELDS, isBlankRecord, type RunMethodMode, type RunRecord } from "@/domain/draft";
import {
  EntryModeSwitch,
  NameCoverage,
  RecordForm,
  RecordList,
  recordState,
  type RecordState,
} from "@/features/records";
import { TableImport, useColumnOptions, type ColumnMatching } from "@/features/table-import";
import { useActions, useDraftSection, useSuggestions } from "@/state";
import { Combobox, Field, RadioGroup, SectionHeading, Select } from "@/ui";

import { shownMethod, useMethodOptions, type MethodChoiceOption } from "./methodOptions";

const RUNS = { list: "runs" } as const;

function runTitle(run: RunRecord, index: number): string {
  const name = run.values.bioinformatics_run_name.trim();
  return name === "" ? `Run ${index + 1}` : name;
}

/** What is wrong with a run's method, or `null`. */
function methodProblem(
  run: RunRecord,
  options: readonly MethodChoiceOption[],
  methodsFromFile: boolean,
): string | null {
  const shown = shownMethod(run.methodRef, options);
  if (shown.gone) return "The method this run used was removed. Choose another one.";
  if (shown.value !== undefined) return null;
  if (options.length === 0)
    return methodsFromFile
      ? "No method is ready yet. Finish the methods table above."
      : "Add a method above first.";
  return "Choose the method this run used.";
}

/** A run's state on its card, counting its method as a required field. */
function runState(run: RunRecord, problem: string | null): RecordState {
  const state = recordState(RUN_FORM_FIELDS, run.values, run.extra);
  if (state.kind === "blank" || problem === null) return state;
  if (state.kind === "invalid") return state;
  return { kind: "missing", count: (state.kind === "missing" ? state.count : 0) + 1 };
}

/** The method select of one run. */
function MethodChoice({
  run,
  options,
  problem,
}: {
  readonly run: RunRecord;
  readonly options: readonly MethodChoiceOption[];
  readonly problem: string | null;
}) {
  const actions = useActions();
  const shown = shownMethod(run.methodRef, options);
  // A blank run is not nagged; a removed method always is.
  const error = shown.gone || !isBlankRecord(run) ? problem : null;
  return (
    <Field
      label="Method"
      required
      hint={
        options.length === 1 && run.methodRef === null
          ? "The only method above, so it is used."
          : "The method above this run used."
      }
      error={error ?? undefined}
    >
      <Select
        options={options}
        value={shown.value}
        disabled={options.length === 0}
        placeholder={options.length === 0 ? "No methods yet" : "Choose a method"}
        onValueChange={(methodRef) =>
          actions.updateItem({
            list: "runs",
            id: run.id,
            recipe: (current) => ({ ...current, methodRef }),
          })
        }
      />
    </Field>
  );
}

/** The runs typed in. */
function RunRecords() {
  const { runs, methods } = useDraftSection("bioinformatics");
  const actions = useActions();
  const { runNames } = useSuggestions();
  const options = useMethodOptions();
  const records = runs.records;
  const fromFile = methods.mode === "table";

  const addNamed = (names: readonly string[]): void => {
    const blanks = records.filter(isBlankRecord).map((record) => record.id);
    for (const name of names) {
      const id = blanks.shift() ?? actions.addItem(RUNS);
      actions.setValue({ ...RUNS, id, key: "bioinformatics_run_name", value: name });
    }
  };
  const taken = new Set(records.map((run) => run.values.bioinformatics_run_name.trim()));
  const nameSuggestions = runNames.filter((name) => !taken.has(name));

  return (
    <div className="flex flex-col gap-5">
      <NameCoverage
        referenced={runNames}
        defined={records.map((run) => run.values.bioinformatics_run_name)}
        source="allele table"
        noun="run"
        onCreate={addNamed}
      />
      <RecordList
        items={records}
        noun="run"
        title={runTitle}
        isBlank={isBlankRecord}
        state={(run) => runState(run, methodProblem(run, options, fromFile))}
        onAdd={() => actions.addItem(RUNS)}
        onRemove={(id) => actions.removeItem(RUNS, id)}
        addLabel="Add a run"
        empty={{
          icon: PlayCircle,
          title: "No runs yet",
          description: "Add each run of the pipeline, named as in the allele table.",
        }}
      >
        {(run) => (
          <RecordForm
            fields={RUN_FORM_FIELDS}
            values={run.values}
            onValueChange={(key, value) => actions.setValue({ ...RUNS, id: run.id, key, value })}
            suggestions={{ bioinformatics_run_name: nameSuggestions }}
            requiredExtra={
              <MethodChoice
                run={run}
                options={options}
                problem={methodProblem(run, options, fromFile)}
              />
            }
            optionalTitle="Date and other details"
            extra={{
              entries: run.extra,
              onUpdate: (recipe) =>
                actions.updateItem({
                  list: "runs",
                  id: run.id,
                  recipe: (current) => ({ ...current, extra: recipe(current.extra) }),
                }),
            }}
          />
        )}
      </RecordList>
    </div>
  );
}

const METHOD_MODES: readonly { value: RunMethodMode; label: string; description: string }[] = [
  {
    value: "same",
    label: "One method for every run",
    description: "All runs used the same pipeline.",
  },
  {
    value: "column",
    label: "Read it from a column",
    description: "A column holds each run's method name, as given in the methods above.",
  },
];

function isRunMethodMode(value: string): value is RunMethodMode {
  return value === "same" || value === "column";
}

/** For a runs table: which method each run used. */
function RunTableMethod({ matching }: { readonly matching: ColumnMatching }) {
  const { runs } = useDraftSection("bioinformatics");
  const actions = useActions();
  const methodOptions = useMethodOptions();
  const columnOptions = useColumnOptions(matching.mapped.table.columns, matching.examples);
  const table = runs.table;
  const shown = shownMethod(table.methodRef, methodOptions);
  const update = (recipe: (current: typeof table) => typeof table): void =>
    actions.updateSection("bioinformatics", (current) => ({
      ...current,
      runs: { ...current.runs, table: recipe(current.runs.table) },
    }));
  return (
    <section aria-labelledby="run-method-heading" className="flex flex-col gap-5">
      <SectionHeading id="run-method-heading" level={3} title="Which method each run used" />
      <RadioGroup
        label="How is the method given?"
        options={METHOD_MODES}
        value={table.methodMode}
        onValueChange={(mode) => {
          if (isRunMethodMode(mode)) actions.setMode({ target: "runsMethod", mode });
        }}
      />
      {table.methodMode === "same" ? (
        <Field
          label="Method"
          required
          error={
            shown.gone
              ? "The method chosen was removed. Choose another one."
              : methodOptions.length === 0
                ? "Add a method above first."
                : undefined
          }
          className="sm:max-w-md"
        >
          <Select
            options={methodOptions}
            value={shown.value}
            disabled={methodOptions.length === 0}
            placeholder={methodOptions.length === 0 ? "No methods yet" : "Choose a method"}
            onValueChange={(methodRef) => update((current) => ({ ...current, methodRef }))}
          />
        </Field>
      ) : (
        <Field
          label="Method name column"
          required
          hint={
            methodOptions.length > 0
              ? `Each value must be one of the method names: ${methodOptions.map((option) => option.label).join(", ")}.`
              : "Each value must be the name of a method above."
          }
          className="sm:max-w-md"
        >
          <Combobox
            mono
            options={columnOptions}
            value={table.methodColumn}
            noneLabel={false}
            placeholder="Choose a column"
            onChange={(methodColumn) => update((current) => ({ ...current, methodColumn }))}
          />
        </Field>
      )}
    </section>
  );
}

/** The runs part of the bioinformatics step: typed in or from a table. */
export function RunsPart() {
  const { runs } = useDraftSection("bioinformatics");
  const actions = useActions();
  return (
    <section aria-labelledby="runs-heading" className="flex flex-col gap-6">
      <SectionHeading
        id="runs-heading"
        title="Runs"
        description="A run is one time the pipeline was run. Name runs as the allele table does, so its alleles are linked to the method that called them."
      />
      <EntryModeSwitch
        label="How to enter runs"
        mode={runs.mode}
        onModeChange={(mode) => actions.setMode({ target: "bioinformaticsRuns", mode })}
        manualHasContent={runs.records.some((run) => !isBlankRecord(run))}
        tableHasContent={runs.table.table !== null}
        manual={<RunRecords />}
        table={
          <TableImport
            slot={{ section: "bioinformatics", part: "runs" }}
            label="Runs table"
            headingLevel={3}
            description="One row for each run, with its name and optionally its date."
          >
            {(matching) => <RunTableMethod matching={matching} />}
          </TableImport>
        }
      />
    </section>
  );
}
