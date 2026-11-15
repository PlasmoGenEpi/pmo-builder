import { plural, t } from "@lingui/core/macro";
import { useMemo } from "react";

import type { RunNameChoice as RunNameValue, RunNameMode } from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";
import { suggestMapping } from "@/domain/matching";
import { useColumnOptions, type ColumnMatching } from "@/features/table-import";
import { useActions, useColumnValues, useDraftSection, useSectionState } from "@/state";
import { Button, Combobox, Field, RadioGroup, SectionHeading, TextField } from "@/ui";

/** The sections whose table can name a bioinformatics run. */
export type RunNameSection = "microhaplotypes" | "readCounts";

/** Props for {@link RunNameChoice}. */
export interface RunNameChoiceProps {
  readonly section: RunNameSection;
  readonly matching: ColumnMatching;
  /** Heading level. Default 2. */
  readonly headingLevel?: 2 | 3;
  /** One sentence under the heading. */
  readonly description: string;
  /** What each choice means for this table. */
  readonly modeDescriptions: Readonly<Record<RunNameMode, string>>;
  /**
   * The run name column's hint until its values are read, as one whole
   * sentence, such as "The column of the allele table that holds each row's run name."
   */
  readonly columnHint: string;
  /** Run names to offer as one-click choices. Blank names and the current name are left out. */
  readonly knownNames: readonly string[];
  /** Said before the run names on offer, such as "From the Bioinformatics step:". */
  readonly knownLabel: string;
}

const MODE_LABELS: Readonly<Record<RunNameMode, string>> = {
  none: t`No run name`,
  fixed: t`One name for the whole table`,
  column: t`Read it from a column`,
};

function isRunNameMode(value: string): value is RunNameMode {
  return value === "none" || value === "fixed" || value === "column";
}

/** The column most like a run name, by the same matching as the field sets. */
function suggestRunColumn(columns: readonly string[]): string | null {
  return (
    suggestMapping(getFieldSet("bioinformaticsRuns"), columns).mapping.fields[
      "bioinformatics_run_name"
    ] ?? null
  );
}

/** The hint that lists the run names a column holds, such as "3 runs: a, b, c." */
function runsHint(values: readonly string[], truncated: boolean): string {
  const shown = values.slice(0, 5);
  const more = values.length - shown.length;
  const runNames = shown.join(", ");
  const runCount = values.length;
  if (truncated) {
    return plural(runCount, {
      one: `More than # run: ${runNames}, and more.`,
      other: `More than # runs: ${runNames}, and more.`,
    });
  }
  if (more > 0) {
    return plural(runCount, {
      one: `# run: ${runNames}, and ${more} more.`,
      other: `# runs: ${runNames}, and ${more} more.`,
    });
  }
  return plural(runCount, { one: `One run: ${runNames}.`, other: `# runs: ${runNames}.` });
}

/**
 * How a table names its bioinformatics run: not at all, one name for every
 * row, or a column. Offers run names given elsewhere, and the column that
 * looks most like a run name. Shared by the allele table and the read counts.
 */
export function RunNameChoice({
  section,
  matching,
  headingLevel = 2,
  description,
  modeDescriptions,
  columnHint,
  knownNames,
  knownLabel,
}: RunNameChoiceProps) {
  const { runName } = useDraftSection(section);
  const actions = useActions();
  const problem =
    useSectionState(section)?.notices.find((notice) => notice.code.startsWith("run-name/"))
      ?.message ?? null;
  const table = matching.mapped.table;
  const columns = table.columns;
  const options = useColumnOptions(columns, matching.examples);
  const suggestedColumn = useMemo(() => suggestRunColumn(columns), [columns]);
  const values = useColumnValues(runName.mode === "column" ? table : null, runName.column, 50);
  const current = runName.fixedName.trim();
  const offered = [...new Set(knownNames.map((name) => name.trim()))].filter(
    (name) => name !== "" && name !== current,
  );
  const headingId = `${section}-run-name-heading`;

  const update = (recipe: (value: RunNameValue) => RunNameValue): void => {
    if (section === "microhaplotypes") {
      actions.updateSection("microhaplotypes", (draft) => ({
        ...draft,
        runName: recipe(draft.runName),
      }));
    } else {
      actions.updateSection("readCounts", (draft) => ({
        ...draft,
        runName: recipe(draft.runName),
      }));
    }
  };

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-5">
      <SectionHeading
        id={headingId}
        level={headingLevel}
        title={t`Bioinformatics run name`}
        description={description}
      />
      <RadioGroup
        label={t`How is the run named?`}
        options={(["none", "fixed", "column"] as const).map((mode) => ({
          value: mode,
          label: MODE_LABELS[mode],
          description: modeDescriptions[mode],
        }))}
        value={runName.mode}
        onValueChange={(mode) => {
          if (!isRunNameMode(mode)) return;
          update((value) => ({
            ...value,
            mode,
            column: mode === "column" && value.column === null ? suggestedColumn : value.column,
          }));
        }}
      />
      {runName.mode === "fixed" ? (
        <div className="flex flex-col gap-2">
          <TextField
            label={t`Run name`}
            mono
            value={runName.fixedName}
            onChange={(event) => {
              const fixedName = event.target.value;
              update((value) => ({ ...value, fixedName }));
            }}
            error={problem}
            className="sm:max-w-sm"
          />
          {offered.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <span>{knownLabel}</span>
              {offered.slice(0, 6).map((name) => (
                <Button
                  key={name}
                  size="sm"
                  onClick={() => update((value) => ({ ...value, fixedName: name }))}
                  aria-label={t`Use the run name ${name}`}
                >
                  <span className="font-mono">{name}</span>
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {runName.mode === "column" ? (
        <Field
          label={t`Run name column`}
          hint={
            values?.kind === "ready" && values.values.length > 0
              ? runsHint(values.values, values.truncated)
              : columnHint
          }
          error={problem}
          className="sm:max-w-md"
        >
          <Combobox
            mono
            options={options}
            value={runName.column}
            onChange={(column) => update((value) => ({ ...value, column }))}
            noneLabel={false}
            placeholder={t`Choose a column`}
          />
        </Field>
      ) : null}
    </section>
  );
}
