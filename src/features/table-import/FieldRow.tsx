import { CircleExclamationPoint, TriangleExclamationPoint } from "lucide-react";
import { useMemo } from "react";

import { Button, Combobox, Field, type ComboboxOption } from "@/ui";

import type { FieldRowModel } from "./mappingModel";

/** The table's columns as combobox options, each with an example value. */
export function useColumnOptions(
  columns: readonly string[],
  examples: Readonly<Record<string, string>>,
): ComboboxOption[] {
  return useMemo(
    () =>
      columns.map((column) => {
        const example = examples[column];
        return example === undefined
          ? { value: column, label: column }
          : { value: column, label: column, description: example };
      }),
    [columns, examples],
  );
}

/** Props for {@link FieldRow}. */
export interface FieldRowProps {
  readonly row: FieldRowModel;
  /** From {@link useColumnOptions}. */
  readonly options: readonly ComboboxOption[];
  readonly onChange: (column: string | null) => void;
  /** Marks a similar-name match as right. */
  readonly onConfirm: () => void;
}

/**
 * One field and the column chosen for it: the field's name and what belongs
 * in it on the left, the column picker on the right. A match made from a
 * similar name asks to be checked; a problem shows under the picker.
 */
export function FieldRow({ row, options, onChange, onConfirm }: FieldRowProps) {
  const { field } = row;
  const error =
    row.problems.length === 0 ? null : (
      <>
        <CircleExclamationPoint aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        <span>{row.problems.join(" ")}</span>
      </>
    );
  return (
    <Field layout="inline" label={field.label} hint={field.description} error={error}>
      <Combobox
        mono
        options={options}
        value={row.column}
        onChange={onChange}
        noneLabel="Not in this table"
        placeholder="Choose a column"
      />
      {row.needsCheck && row.problems.length === 0 ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-warning-text">
          <span className="flex items-start gap-1.5">
            <TriangleExclamationPoint
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            Matched by a similar name. Check it is right.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onConfirm}
            aria-label={`${field.label}: keep this match`}
          >
            Keep it
          </Button>
        </div>
      ) : null}
    </Field>
  );
}
