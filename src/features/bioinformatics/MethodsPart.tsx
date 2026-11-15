import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
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
  label: t`Method name`,
  description: t`A name for the pipeline, such as MAD4HATTER v0.2. Needed to tell several apart.`,
  required: false,
  kind: "text",
  format: null,
  example: "MAD4HATTER v0.2",
};

function stepTitle(step: MethodStepRecord, index: number): string {
  const program = step.values.program.trim();
  const number = index + 1;
  return program === "" ? t`Step ${number}` : t`Step ${number}: ${program}`;
}

/** The steps of one method, in the order they ran. */
function MethodSteps({ method }: { readonly method: MethodRecord }) {
  const actions = useActions();
  const path = { list: "methodSteps", methodId: method.id } as const;
  const methodName = method.name.trim();
  return (
    <section
      aria-label={methodName === "" ? t`Steps of this method` : t`Steps of ${methodName}`}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-0.5">
        <h4 className="text-base font-medium text-text">
          <Trans>Steps</Trans>
        </h4>
        <p className="text-sm text-text-muted">
          <Trans>
            Each program the pipeline ran, in order. Most pipelines need only the main one.
          </Trans>
        </p>
      </div>
      <RecordList
        items={method.steps}
        variant="inset"
        headingLevel={4}
        listLabel={t({
          message: "steps",
          comment: "Accessible name of the list of a method's step cards",
        })}
        title={stepTitle}
        isBlank={isBlankRecord}
        state={(step) => recordState(METHOD_STEP_FORM_FIELDS, step.values, step.extra)}
        onAdd={() => actions.addItem(path)}
        onRemove={(id) => actions.removeItem(path, id)}
        onMove={(id, to) => actions.moveItem(path, id, to)}
        addLabel={t`Add a step`}
        empty={{
          icon: Workflow,
          title: t`No steps yet`,
          description: t`Add the program this method ran, with its version.`,
        }}
      >
        {(step) => (
          <RecordForm
            fields={METHOD_STEP_FORM_FIELDS}
            values={step.values}
            onValueChange={(key, value) => actions.setValue({ ...path, id: step.id, key, value })}
            fixes={{ program_url: removeScheme }}
            optionalTitle={t`Arguments and link`}
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
      const number = index + 1;
      return uses ? [run.values.bioinformatics_run_name.trim() || t`Run ${number}`] : [];
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
      listLabel={t({
        message: "methods",
        comment: "Accessible name of the list of bioinformatics method cards",
      })}
      title={methodTitle}
      isBlank={isBlankMethod}
      state={(method) => methodState(method)}
      onAdd={add}
      onRemove={(id) => actions.removeItem(METHODS, id)}
      removeWarning={(method) => {
        const using = runsUsing(method);
        if (using.length === 0) return null;
        const runName = using[0] ?? "";
        return using.length === 1
          ? t`The run ${runName} uses this method and will need another one.`
          : plural(using.length, {
              one: "# run uses this method and will need another one.",
              other: "# runs use this method and will need another one.",
            });
      }}
      addLabel={t`Add a method`}
      empty={{
        icon: Workflow,
        title: t`No methods yet`,
        description: t`Add the pipeline that produced your allele table: its programs and versions.`,
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

/**
 * The hint under the method name column once its values are read: how many
 * methods it names, the first few, and that runs refer to them by name.
 */
function methodListHint(names: readonly string[], truncated: boolean): string {
  const total = names.length;
  const methodNames = names.slice(0, 5).join(", ");
  const atLeast = truncated && total !== 1;
  if (total > 5)
    return atLeast
      ? plural(total, {
          one: `More than # method: ${methodNames}, and more. Runs refer to a method by this name.`,
          other: `More than # methods: ${methodNames}, and more. Runs refer to a method by this name.`,
        })
      : plural(total, {
          one: `# method: ${methodNames}, and more. Runs refer to a method by this name.`,
          other: `# methods: ${methodNames}, and more. Runs refer to a method by this name.`,
        });
  return atLeast
    ? plural(total, {
        one: `More than # method: ${methodNames}. Runs refer to a method by this name.`,
        other: `More than # methods: ${methodNames}. Runs refer to a method by this name.`,
      })
    : plural(total, {
        one: `# method: ${methodNames}. Runs refer to a method by this name.`,
        other: `# methods: ${methodNames}. Runs refer to a method by this name.`,
      });
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
      ? t`Every row is one step of a single method.`
      : values?.kind === "ready"
        ? methodListHint(values.values, values.truncated)
        : t`Rows with the same value form one method, named by that value.`;
  return (
    <section aria-labelledby="method-group-heading" className="flex flex-col gap-4">
      <SectionHeading
        id="method-group-heading"
        level={3}
        title={t`One method or several`}
        description={t`If the table holds more than one pipeline, choose the column that names each row's method.`}
      />
      <Field label={t`Method name column`} hint={hint} className="sm:max-w-md">
        <Combobox
          mono
          options={options}
          value={column}
          noneLabel={t`One method for the whole table`}
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
        title={t`Methods`}
        description={t`A method is a pipeline: the programs it ran and their versions. Start here, since each run names its method.`}
      />
      <EntryModeSwitch
        label={t`How to enter methods`}
        mode={methods.mode}
        onModeChange={(mode) => actions.setMode({ target: "bioinformaticsMethods", mode })}
        manualHasContent={methods.records.some((method) => !isBlankMethod(method))}
        tableHasContent={methods.table.table !== null}
        manual={<MethodRecords />}
        table={
          <TableImport
            slot={{ section: "bioinformatics", part: "methods" }}
            label={t`Methods table`}
            headingLevel={3}
            description={t`One row for each step: the program and its version, and optionally a column naming the method.`}
          >
            {(matching) => <GroupColumn matching={matching} />}
          </TableImport>
        }
      />
    </section>
  );
}
