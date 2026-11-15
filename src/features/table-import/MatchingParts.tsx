import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleCheck, CircleExclamationPoint, TriangleExclamationPoint } from "lucide-react";
import { useId, useState } from "react";

import { Button, Checkbox, Disclosure, SectionHeading, TextField, cn } from "@/ui";

import { FieldRow, useColumnOptions } from "./FieldRow";
import { groupOptionalRows, summaryLine, type FieldRowModel } from "./mappingModel";
import type { ColumnMatching } from "./useColumnMatching";

/** Props shared by the matching parts. */
export interface MatchingPartProps {
  /** From `useColumnMatching(slot)`. */
  readonly matching: ColumnMatching;
}

/**
 * The one-line summary of the matches, such as "4 of 4 required fields
 * matched, 6 optional fields matched". Announced politely as it changes.
 */
export function MatchSummary({ matching }: MatchingPartProps) {
  const { counts } = matching.model;
  const missing = counts.requiredMatched < counts.requiredTotal || counts.withProblems > 0;
  const tone = missing ? "danger" : counts.toCheck > 0 ? "warning" : "success";
  const Icon =
    tone === "danger"
      ? CircleExclamationPoint
      : tone === "warning"
        ? TriangleExclamationPoint
        : CircleCheck;
  return (
    <p className="flex items-start gap-2 text-base text-text" aria-live="polite">
      <Icon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4.5 shrink-0",
          tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-success",
        )}
      />
      <span>{summaryLine(counts)}</span>
    </p>
  );
}

function Rows({
  rows,
  matching,
}: {
  readonly rows: readonly FieldRowModel[];
  readonly matching: ColumnMatching;
}) {
  const options = useColumnOptions(matching.mapped.table.columns, matching.examples);
  return (
    <ul className="flex flex-col gap-5">
      {rows.map((row) => (
        <li key={row.field.key}>
          <FieldRow
            row={row}
            options={options}
            onChange={(column) => matching.setField(row.field.key, column)}
            onConfirm={() => matching.confirm(row.field.key)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Props for {@link RequiredFields}. */
export interface RequiredFieldsProps extends MatchingPartProps {
  /** Heading level of "Required fields". Default 3. */
  readonly headingLevel?: 2 | 3 | 4;
}

/** The required fields, always shown, each with its column picker. */
export function RequiredFields({ matching, headingLevel = 3 }: RequiredFieldsProps) {
  const id = useId();
  const Heading = headingLevel === 2 ? "h2" : headingLevel === 3 ? "h3" : "h4";
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <Heading id={id} className="text-md font-semibold text-text">
        <Trans>Required fields</Trans>
      </Heading>
      <Rows rows={matching.model.required} matching={matching} />
    </section>
  );
}

/**
 * The optional fields in a collapsed section with a filter box and the count
 * of matched fields. Fields matched when the section was opened come first;
 * the rest are grouped.
 */
export function OptionalFields({ matching }: MatchingPartProps) {
  const { optional, counts } = matching.model;
  const [filter, setFilter] = useState("");
  const [matchedFirst, setMatchedFirst] = useState<ReadonlySet<string>>(
    () => new Set(optional.filter((row) => row.column !== null).map((row) => row.field.key)),
  );
  // A new table brings new matches: take a fresh snapshot of what is matched.
  const [snapshotTable, setSnapshotTable] = useState(matching.mapped.table.id);
  if (snapshotTable !== matching.mapped.table.id) {
    setSnapshotTable(matching.mapped.table.id);
    setMatchedFirst(
      new Set(optional.filter((row) => row.column !== null).map((row) => row.field.key)),
    );
  }
  if (optional.length === 0) return null;
  const groups = groupOptionalRows(optional, { filter, matchedFirst });
  const problemCount = optional.filter((row) => row.problems.length > 0).length;
  const { optionalMatched, optionalTotal } = counts;

  return (
    <Disclosure
      title={t`Optional fields`}
      summary={
        problemCount > 0
          ? t`${optionalMatched} of ${optionalTotal} matched, ${problemCount} to fix`
          : t`${optionalMatched} of ${optionalTotal} matched`
      }
      defaultOpen={problemCount > 0}
      onOpenChange={(open) => {
        if (open)
          setMatchedFirst(
            new Set(optional.filter((row) => row.column !== null).map((row) => row.field.key)),
          );
      }}
    >
      <div className="flex flex-col gap-6">
        <TextField
          label={t`Filter optional fields`}
          hideLabel
          type="search"
          placeholder={t`Filter by name or column`}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          className="sm:max-w-xs"
        />
        {groups.length === 0 ? (
          <p className="text-base text-text-muted">
            <Trans>No optional field matches &quot;{filter}&quot;.</Trans>
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.title} className="flex flex-col gap-4">
              <h4 className="text-sm font-medium text-text-muted">{group.title}</h4>
              <Rows rows={group.rows} matching={matching} />
            </section>
          ))
        )}
      </div>
    </Disclosure>
  );
}

/**
 * The columns not matched to any field, each with a checkbox to carry it
 * into the PMO as it is. Shown only for tables that allow extra columns.
 */
export function ExtraColumns({ matching }: MatchingPartProps) {
  const { unmappedColumns, extraColumnChoices, extraProblems } = matching.model;
  if (!matching.fieldSet.allowsAdditionalColumns || extraColumnChoices.length === 0) return null;
  const current = matching.mapped.mapping.additionalColumns;
  const chosen = new Set(current);
  const included = unmappedColumns.filter((column) => chosen.has(column));
  const includedCount = included.length;
  const columnCount = unmappedColumns.length;
  const problemCount = extraProblems.size;
  const summary =
    problemCount > 0
      ? t`${includedCount} of ${columnCount} included, ${problemCount} to fix`
      : t`${includedCount} of ${columnCount} included`;
  return (
    <Disclosure title={t`Extra columns`} summary={summary} defaultOpen={problemCount > 0}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <p className="max-w-prose text-base text-text-muted">
            <Trans>
              These columns are not matched to a field. Tick the ones to carry into the PMO as they
              are.
            </Trans>
          </p>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={included.length === unmappedColumns.length}
              onClick={() => matching.setAdditionalColumns([...current, ...unmappedColumns])}
            >
              <Trans>Select all</Trans>
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={current.length === 0}
              onClick={() => matching.setAdditionalColumns([])}
            >
              <Trans>Select none</Trans>
            </Button>
          </div>
        </div>
        <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {extraColumnChoices.map((column) => {
            const example = matching.examples[column];
            const problem = extraProblems.get(column);
            return (
              <li key={column} className="min-w-0">
                <Checkbox
                  label={<span className="font-mono text-sm break-all">{column}</span>}
                  description={
                    problem === undefined ? (
                      example === undefined ? undefined : (
                        <span className="block truncate">
                          <Trans>For example {example}</Trans>
                        </span>
                      )
                    ) : (
                      <span className="flex items-start gap-1.5 text-danger-text">
                        <CircleExclamationPoint
                          aria-hidden="true"
                          className="mt-0.5 size-3.5 shrink-0"
                        />
                        {problem}
                      </span>
                    )
                  }
                  checked={chosen.has(column)}
                  onCheckedChange={(checked) =>
                    matching.setAdditionalColumns(
                      checked ? [...current, column] : current.filter((other) => other !== column),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </div>
    </Disclosure>
  );
}

/** Props for {@link ColumnMatcher}. */
export interface ColumnMatcherProps extends MatchingPartProps {
  /** Heading level of "Match columns". Default 2; use 3 inside a step with several tables. */
  readonly headingLevel?: 2 | 3;
}

/**
 * Every matching part in order: heading, summary, required fields, optional
 * fields and extra columns.
 */
export function ColumnMatcher({ matching, headingLevel = 2 }: ColumnMatcherProps) {
  const id = useId();
  return (
    <section className="flex flex-col gap-6" aria-labelledby={id}>
      <div className="flex flex-col gap-2">
        <SectionHeading
          id={id}
          level={headingLevel}
          title={t`Match columns`}
          description={t`Each field of the PMO is matched to a column of your table. Check the matches and change any that are wrong.`}
        />
        <MatchSummary matching={matching} />
      </div>
      <RequiredFields matching={matching} headingLevel={headingLevel === 2 ? 3 : 4} />
      <div className="flex flex-col gap-3">
        <OptionalFields matching={matching} />
        <ExtraColumns matching={matching} />
      </div>
    </section>
  );
}
