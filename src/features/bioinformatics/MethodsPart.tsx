import { Workflow } from "lucide-react";

import {
  METHOD_STEP_FORM_FIELDS,
  isBlankRecord,
  type FormFieldSpec,
  type MethodRecord,
  type MethodStepRecord,
} from "@/domain/draft";
import {
  EntryModeSwitch,
  RecordField,
  RecordForm,
  RecordList,
  recordState,
  removeScheme,
} from "@/features/records";
import { TableImport, useColumnOptions, type ColumnMatching } from "@/features/table-import";
import { useActions, useColumnValues, useDraftSection } from "@/state";
import { Combobox, Field, SectionHeading } from "@/ui";

import { isBlankMethod, methodState, methodTitle } from "./methodOptions";

const METHODS = { list: "methods" } as const;

/** The method name is not a PMO record field of its own, so it has a spec here. */
const METHOD_NAME: FormFieldSpec = {
  key: "bioinformatics_method_name",
  label: "Method name",
  description: "A name for the pipeline, such as MAD4HATTER v0.2. Needed to tell several apart.",
  required: false,
  kind: "text",
  format: null,
  example: "MAD4HATTER v0.2",
};

function stepTitle(step: MethodStepRecord, index: number): string {
  const program = step.values.program.trim();
  return program === "" ? `Step ${index + 1}` : `Step ${index + 1}: ${program}`;
}

/** The steps of one method, in the order they ran. */
function MethodSteps({ method }: { readonly method: MethodRecord }) {
  const actions = useActions();
  const path = { list: "methodSteps", methodId: method.id } as const;
  return (
    <section
      aria-label={`Steps of ${method.name.trim() || "this method"}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-base font-medium text-text">Steps</h4>
        <p className="text-sm text-text-muted">
          Each program the pipeline ran, in order. Most pipelines need only the main one.
        </p>
      </div>
      <RecordList
        items={method.steps}
        variant="inset"
        headingLevel={4}
        noun="step"
        title={stepTitle}
        isBlank={isBlankRecord}
        state={(step) => recordState(METHOD_STEP_FORM_FIELDS, step.values, step.extra)}
        onAdd={() => actions.addItem(path)}
        onRemove={(id) => actions.removeItem(path, id)}
        onMove={(id, to) => actions.moveItem(path, id, to)}
        addLabel="Add a step"
        empty={{
          icon: Workflow,
          title: "No steps yet",
          description: "Add the program this method ran, with its version.",
        }}
      >
        {(step) => (
          <RecordForm
            fields={METHOD_STEP_FORM_FIELDS}
            values={step.values}
            onValueChange={(key, value) => actions.setValue({ ...path, id: step.id, key, value })}
            fixes={{ program_url: removeScheme }}
            optionalTitle="Arguments and link"
            extra={{
              entries: step.extra,
              onUpdate: (recipe) =>
                actions.updateItem({
                  list: "methodSteps",
                  methodId: method.id,
                  id: step.id,
                  recipe: (current) => ({ ...current, extra: recipe(current.extra) }),
                }),
            }}
          />
        )}
      </RecordList>
    </section>
  );
}

/** The methods typed in, each with its steps. */
function MethodRecords() {
  const { methods, runs } = useDraftSection("bioinformatics");
  const actions = useActions();
  const records = methods.records;

  const runsUsing = (method: MethodRecord): readonly string[] =>
    runs.records.flatMap((run, index) => {
      const uses =
        run.methodRef === method.id ||
        (run.methodRef === null && records.length === 1 && !isBlankRecord(run));
      return uses ? [run.values.bioinformatics_run_name.trim() || `Run ${index + 1}`] : [];
    });

  const add = (): string => {
    // With one method, runs use it without choosing. Pin them to it before a second arrives.
    const only = records.length === 1 ? records[0] : undefined;
    if (only !== undefined) {
      for (const run of runs.records) {
        if (run.methodRef === null)
          actions.updateItem({
            list: "runs",
            id: run.id,
            recipe: (current) => ({ ...current, methodRef: only.id }),
          });
      }
    }
    return actions.addItem(METHODS);
  };

  return (
    <RecordList
      items={records}
      noun="method"
      title={methodTitle}
      isBlank={isBlankMethod}
      state={(method) => methodState(method)}
      onAdd={add}
      onRemove={(id) => actions.removeItem(METHODS, id)}
      removeWarning={(method) => {
        const using = runsUsing(method);
        if (using.length === 0) return null;
        return using.length === 1
          ? `The run ${using[0] ?? ""} uses this method and will need another one.`
          : `${using.length} runs use this method and will need another one.`;
      }}
      addLabel="Add a method"
      empty={{
        icon: Workflow,
        title: "No methods yet",
        description: "Add the pipeline that produced your allele table: its programs and versions.",
      }}
    >
      {(method) => (
        <div className="flex flex-col gap-6">
          <RecordField
            spec={METHOD_NAME}
            value={method.name}
            onCommit={(name) =>
              actions.updateItem({
                list: "methods",
                id: method.id,
                recipe: (current) => ({ ...current, name }),
              })
            }
            className="sm:max-w-md"
          />
          <MethodSteps method={method} />
        </div>
      )}
    </RecordList>
  );
}

/** For a methods table: the column, if any, that splits its rows into methods. */
function GroupColumn({ matching }: { readonly matching: ColumnMatching }) {
  const { methods } = useDraftSection("bioinformatics");
  const actions = useActions();
  const table = matching.mapped.table;
  const options = useColumnOptions(table.columns, matching.examples);
  const column = methods.table.groupColumn;
  const values = useColumnValues(column === null ? null : table, column, 50);
  const hint =
    column === null
      ? "Every row is one step of a single method."
      : values?.kind === "ready"
        ? `${values.values.length === 1 ? "1 method" : `${values.truncated ? "More than " : ""}${values.values.length} methods`}: ${values.values.slice(0, 5).join(", ")}${values.values.length > 5 ? ", and more" : ""}. Runs refer to a method by this name.`
        : "Rows with the same value form one method, named by that value.";
  return (
    <section aria-labelledby="method-group-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="method-group-heading"
        level={3}
        title="One method or several"
        description="If the table holds more than one pipeline, choose the column that names each row's method."
      />
      <Field label="Method name column" hint={hint} className="sm:max-w-md">
        <Combobox
          mono
          options={options}
          value={column}
          noneLabel="One method for the whole table"
          onChange={(groupColumn) =>
            actions.updateSection("bioinformatics", (current) => ({
              ...current,
              methods: { ...current.methods, table: { ...current.methods.table, groupColumn } },
            }))
          }
        />
      </Field>
    </section>
  );
}

/** The methods part of the bioinformatics step: typed in or from a table. */
export function MethodsPart() {
  const { methods } = useDraftSection("bioinformatics");
  const actions = useActions();
  return (
    <section aria-labelledby="methods-heading" className="flex flex-col gap-6">
      <SectionHeading
        id="methods-heading"
        title="Methods"
        description="A method is a pipeline: the programs it ran and their versions. Start here, since each run names its method."
      />
      <EntryModeSwitch
        label="How to enter methods"
        mode={methods.mode}
        onModeChange={(mode) => actions.setMode({ target: "bioinformaticsMethods", mode })}
        manualHasContent={methods.records.some((method) => !isBlankMethod(method))}
        tableHasContent={methods.table.table !== null}
        manual={<MethodRecords />}
        table={
          <TableImport
            slot={{ section: "bioinformatics", part: "methods" }}
            label="Methods table"
            headingLevel={3}
            description="One row for each step: the program and its version, and optionally a column naming the method."
          >
            {(matching) => <GroupColumn matching={matching} />}
          </TableImport>
        }
      />
    </section>
  );
}
