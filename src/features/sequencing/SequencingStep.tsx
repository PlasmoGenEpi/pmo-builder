import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Dna } from "lucide-react";

import { StepPage } from "@/app/StepPage";
import {
  SEQUENCING_FORM_FIELDS,
  createKeyValue,
  isBlankRecord,
  type SequencingFieldKey,
  type SequencingRecord,
} from "@/domain/draft";
import {
  EntryModeSwitch,
  NameCoverage,
  RecordForm,
  RecordList,
  StepIntro,
  otherValues,
  recordState,
} from "@/features/records";
import { SectionResult } from "@/features/shared";
import { TableImport } from "@/features/table-import";
import { useActions, useDraftSection, useSuggestions } from "@/state";

const LIST = { list: "sequencingRuns" } as const;
const NAME_KEY = "sequencing_info_name";

function runTitle(record: SequencingRecord, index: number): string {
  const name = record.values.sequencing_info_name.trim();
  const number = index + 1;
  return name === "" ? t`Sequencing run ${number}` : name;
}

/** For each field, what other runs hold, so a second run can reuse the first one's values. */
function suggestionsFor(
  records: readonly SequencingRecord[],
  record: SequencingRecord,
  names: readonly string[],
): Partial<Record<SequencingFieldKey, readonly string[]>> {
  const result: Partial<Record<SequencingFieldKey, readonly string[]>> = {};
  for (const field of SEQUENCING_FORM_FIELDS) {
    if (field.key === NAME_KEY) continue;
    const values = otherValues(records, field.key, record.id);
    if (values.length > 0) result[field.key] = values;
  }
  const taken = new Set(records.map((other) => other.values.sequencing_info_name.trim()));
  result[NAME_KEY] = names.filter((name) => !taken.has(name));
  return result;
}

/** The sequencing runs typed in. */
function SequencingRecords() {
  const { records } = useDraftSection("sequencing");
  const actions = useActions();
  const { sequencingNames } = useSuggestions();

  const addNamed = (names: readonly string[]): void => {
    const blanks = records.filter(isBlankRecord).map((record) => record.id);
    for (const name of names) {
      const id = blanks.shift() ?? actions.addItem(LIST);
      actions.setValue({ ...LIST, id, key: NAME_KEY, value: name });
    }
  };

  const duplicate = (id: string): string => {
    const source = records.find((record) => record.id === id);
    const copy = actions.addItem(LIST);
    if (source !== undefined)
      actions.updateItem({
        list: "sequencingRuns",
        id: copy,
        recipe: (current) => ({
          ...current,
          values: { ...source.values, [NAME_KEY]: "" },
          extra: source.extra.map((entry) => createKeyValue(entry.key, entry.value)),
        }),
      });
    return copy;
  };

  return (
    <div className="flex flex-col gap-5">
      <NameCoverage
        referenced={sequencingNames}
        defined={records.map((record) => record.values.sequencing_info_name)}
        source={t`library sample table`}
        noun={t`sequencing run`}
        onCreate={addNamed}
      />
      <RecordList
        items={records}
        noun={t`sequencing run`}
        title={runTitle}
        isBlank={isBlankRecord}
        state={(record) => recordState(SEQUENCING_FORM_FIELDS, record.values, record.extra)}
        onAdd={() => actions.addItem(LIST)}
        onRemove={(id) => actions.removeItem(LIST, id)}
        onDuplicate={duplicate}
        addLabel={t`Add a sequencing run`}
        empty={{
          icon: Dna,
          title: t`No sequencing runs yet`,
          description: t`Add one for each sequencing run, with its platform, instrument and library details.`,
        }}
      >
        {(record) => (
          <RecordForm
            fields={SEQUENCING_FORM_FIELDS}
            values={record.values}
            onValueChange={(key, value) => actions.setValue({ ...LIST, id: record.id, key, value })}
            suggestions={suggestionsFor(records, record, sequencingNames)}
            optionalTitle={t`Kit, dates and other details`}
            extra={{
              entries: record.extra,
              onUpdate: (recipe) =>
                actions.updateItem({
                  list: "sequencingRuns",
                  id: record.id,
                  recipe: (current) => ({ ...current, extra: recipe(current.extra) }),
                }),
            }}
          />
        )}
      </RecordList>
    </div>
  );
}

/** The sequencing step: one record for each sequencing run, typed in or from a table. */
export function SequencingStep() {
  const sequencing = useDraftSection("sequencing");
  const actions = useActions();
  return (
    <StepPage stepId="sequencing">
      <div className="flex flex-col gap-10">
        <StepIntro>
          <Trans>
            Optional. Sequencing runs tell readers of the PMO which platform, instrument and library
            preparation produced the reads. The library sample table links each sample to a run by
            its name.
          </Trans>
        </StepIntro>
        <EntryModeSwitch
          label={t`How to enter sequencing runs`}
          mode={sequencing.mode}
          onModeChange={(mode) => actions.setMode({ target: "sequencing", mode })}
          manualHasContent={sequencing.records.some((record) => !isBlankRecord(record))}
          tableHasContent={sequencing.table !== null}
          manual={<SequencingRecords />}
          table={
            <TableImport
              slot={{ section: "sequencing" }}
              label={t`Sequencing table`}
              description={t`One row for each sequencing run, with its name, platform and library details.`}
            />
          }
        />
        <SectionResult
          section="sequencing"
          emptyMessage={t`Nothing here yet. Fill in a sequencing run above to add it to the PMO.`}
          stats={(summary) => [
            {
              label: plural(summary.runs, { one: "Sequencing run", other: "Sequencing runs" }),
              value: summary.runs,
              hint: summary.names.length > 0 ? summary.names.slice(0, 3).join(", ") : undefined,
            },
          ]}
        />
      </div>
    </StepPage>
  );
}
