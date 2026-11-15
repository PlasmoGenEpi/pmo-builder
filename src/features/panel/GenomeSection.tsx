import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { useId, useState } from "react";

import {
  GENOME_FORM_FIELDS,
  isBlankRecord,
  readFieldValue,
  type GenomeFieldKey,
  type GenomeMode,
  type PanelEntry,
} from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";
import type { Notice } from "@/domain/types";
import { TableImport } from "@/features/table-import";
import { intlLocale } from "@/i18n/languages";
import { useActions } from "@/state";
import { Callout, SegmentedControl, TextArea, TextField, type Segment } from "@/ui";

import { genomeNotices, mappedPositionFields } from "./panelModel";

const MODES: readonly Segment<GenomeMode>[] = [
  { value: "none", label: t({ message: "None", comment: "Reference genome choice: no genome" }) },
  { value: "manual", label: t`Enter by hand` },
  { value: "table", label: t`From a file` },
];

const MODE_LINE: Readonly<Record<GenomeMode, string>> = {
  none: t`Only needed when the target table says where each target sits on the genome.`,
  manual: t`The reference genome the target positions refer to.`,
  table: t`A table with one row for each reference genome, for panels that use several.`,
};

function positionLabels(keys: readonly string[]): string {
  const fields = getFieldSet("panelTargets").fields;
  const labels = keys.map((key) => fields.find((field) => field.key === key)?.label ?? key);
  const lower = labels.map((label) => label.toLowerCase());
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(lower);
}

/** A text field's hint with its example: "The genome's name, such as GRCh38." */
function exampleHint(field: { readonly description: string; readonly example: string }): string {
  const description = field.description.replace(/\.$/, "");
  const example = field.example;
  return t`${description}, such as ${example}.`;
}

/** The hand-entered genome: one field for each key, checked as the user types. */
function GenomeForm({ entry }: { readonly entry: PanelEntry }) {
  const actions = useActions();
  const record = entry.genome.manual;
  // A required field left blank is flagged once the user has been in it and left.
  const [visited, setVisited] = useState<ReadonlySet<string>>(() => new Set());
  const started = !isBlankRecord(record);

  const setValue = (key: GenomeFieldKey, value: string) =>
    actions.updateItem({
      list: "panels",
      id: entry.id,
      recipe: (panel) => ({
        ...panel,
        genome: {
          ...panel.genome,
          manual: {
            ...panel.genome.manual,
            values: { ...panel.genome.manual.values, [key]: value },
          },
        },
      }),
    });

  return (
    <div className="grid gap-x-6 gap-y-5 sm:grid-cols-2">
      {GENOME_FORM_FIELDS.map((field) => {
        const raw = record.values[field.key];
        const read = readFieldValue(field, raw, "form");
        const error =
          read.kind === "invalid"
            ? read.message
            : read.kind === "blank" && field.required && started && visited.has(field.key)
              ? t`Fill this in, or set the reference genome to None.`
              : null;
        const common = {
          label: field.label,
          hint: field.kind !== "text" ? field.description : exampleHint(field),
          required: field.required,
          optional: !field.required,
          value: raw,
          onBlur: () => setVisited((current) => new Set(current).add(field.key)),
          spellCheck: false,
          error,
        };
        const wide = field.kind === "url" || field.kind === "list";
        if (field.kind === "list" || field.kind === "integerList") {
          return (
            <TextArea
              key={field.key}
              {...common}
              mono
              rows={field.kind === "integerList" ? 1 : 3}
              className={wide ? "sm:col-span-2" : undefined}
              onChange={(event) => setValue(field.key, event.target.value)}
            />
          );
        }
        return (
          <TextField
            key={field.key}
            {...common}
            mono
            type={field.kind === "url" ? "url" : "text"}
            className={wide ? "sm:col-span-2" : undefined}
            onChange={(event) => setValue(field.key, event.target.value)}
          />
        );
      })}
    </div>
  );
}

/** Props for {@link GenomeSection}. */
export interface GenomeSectionProps {
  readonly entry: PanelEntry;
  /** This panel's notices from the latest build. */
  readonly notices: readonly Notice[];
  readonly headingLevel: 2 | 3;
}

/**
 * The panel's reference genome: none, typed in, or a table. Kept quiet until
 * the target table has positions without a genome, or the other way round,
 * which it says right here.
 */
export function GenomeSection({ entry, notices, headingLevel }: GenomeSectionProps) {
  const actions = useActions();
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const mode = entry.genome.mode;
  const positions = mappedPositionFields(entry);
  const genomeTableId = entry.genome.table?.table.id ?? null;
  const problems = genomeNotices(notices, genomeTableId).filter(
    (notice) =>
      // The fields and the drop area below already say what is missing.
      notice.code !== "genome/missing" &&
      // The warning below says this better while no genome is chosen.
      !(mode === "none" && notice.code === "panel/location-without-genome"),
  );
  const needsGenome = mode === "none" && positions.length > 0;
  const positionFields = positionLabels(positions);
  const unused = mode !== "none" && entry.table !== null && positions.length === 0;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Heading id={headingId} className="text-md font-semibold text-text">
            <Trans>
              Reference genome <span className="font-normal text-text-muted">(optional)</span>
            </Trans>
          </Heading>
          <p className="max-w-prose text-sm text-text-muted">{MODE_LINE[mode]}</p>
        </div>
        <SegmentedControl
          label={t`Reference genome`}
          size="sm"
          segments={MODES}
          value={mode}
          onValueChange={(next) =>
            actions.setMode({ target: "panelGenome", panelId: entry.id, mode: next })
          }
        />
      </div>
      {needsGenome ? (
        <Callout tone="warning" title={t`The target positions need a genome`}>
          {t`The target table gives the ${positionFields} of each target. Add the reference genome they refer to, or set those fields to "Not in this table" above.`}
        </Callout>
      ) : null}
      {unused ? (
        <p className="max-w-prose text-sm text-text-muted">
          <Trans>
            No position columns are matched in the target table, so the genome is stored with the
            panel but no target points to it. Match the start and end columns above if your table
            has them.
          </Trans>
        </p>
      ) : null}
      {problems.map((notice) => (
        <Callout
          key={`${notice.code}:${notice.message}`}
          tone={notice.severity === "error" ? "error" : "warning"}
        >
          {notice.message}
        </Callout>
      ))}
      {mode === "manual" ? <GenomeForm entry={entry} /> : null}
      {mode === "table" ? (
        <TableImport
          slot={{ section: "panel", panelId: entry.id, part: "genome" }}
          label={t`Genome table`}
          description={t`One row for each reference genome, with its name, version, taxon ID and link.`}
          headingLevel={3}
        />
      ) : null}
    </section>
  );
}
