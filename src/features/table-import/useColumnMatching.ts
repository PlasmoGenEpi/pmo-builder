import { useCallback, useMemo } from "react";

import { fieldSetForSlot, type MappedTable, type TableSlot } from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";
import { checkMapping, suggestMapping } from "@/domain/matching";
import type { ColumnMapping, FieldSetSpec } from "@/domain/types";
import { useActions, useSlotTable, useTablePreview, type PreviewState } from "@/state";

import { confirmationKeys } from "./confirmations";
import {
  describeMapping,
  firstValues,
  withAdditionalColumns,
  withFieldColumn,
  type MappingModel,
} from "./mappingModel";

/** How many rows the preview and the example values read. */
export const PREVIEW_ROWS = 50;

/** Called with the new mapping after the user changes it. */
export type MappingChangeHandler = (mapping: ColumnMapping) => void;

/** Everything the matching parts need for one slot. */
export interface ColumnMatching {
  readonly slot: TableSlot;
  readonly fieldSet: FieldSetSpec;
  readonly mapped: MappedTable;
  readonly model: MappingModel;
  /** The first non-blank value of each column, from the preview rows. Empty while they load. */
  readonly examples: Readonly<Record<string, string>>;
  /** The preview rows, shared with the preview part. */
  readonly preview: PreviewState | null;
  /** Chooses a column for a field, or clears it with `null`. */
  readonly setField: (key: string, column: string | null) => void;
  /** Marks a similar-name match as right. */
  readonly confirm: (key: string) => void;
  /** Replaces the extra columns carried into the PMO. */
  readonly setAdditionalColumns: (columns: readonly string[]) => void;
}

/**
 * The matching state of the table in a slot, or `null` when the slot is
 * empty. Changes go straight to the store, which saves and rebuilds.
 */
export function useColumnMatching(
  slot: TableSlot,
  onMappingChange?: MappingChangeHandler,
): ColumnMatching | null {
  const mapped = useSlotTable(slot);
  const actions = useActions();
  const fieldSetId = fieldSetForSlot(slot);
  const fieldSet = getFieldSet(fieldSetId);
  const preview = useTablePreview(mapped?.table ?? null, { limit: PREVIEW_ROWS });

  const columns = mapped?.table.columns;
  const matches = useMemo(
    () => (columns === undefined ? {} : suggestMapping(fieldSet, columns).matches),
    [fieldSet, columns],
  );
  const mapping = mapped?.mapping;
  const problems = useMemo(
    () =>
      columns === undefined || mapping === undefined
        ? []
        : checkMapping(fieldSet, columns, mapping),
    [fieldSet, columns, mapping],
  );
  const tableId = mapped?.table.id ?? "";
  const confirmedMatches = mapped?.confirmedMatches;
  const confirmed = useMemo(
    () => confirmationKeys(tableId, confirmedMatches),
    [tableId, confirmedMatches],
  );
  const model = useMemo(
    () =>
      describeMapping({
        fieldSet,
        tableId,
        columns: columns ?? [],
        mapping: mapping ?? { fields: {}, additionalColumns: [] },
        matches,
        problems,
        confirmed,
      }),
    [fieldSet, tableId, columns, mapping, matches, problems, confirmed],
  );
  const previewRows = preview?.kind === "ready" ? preview.rows : null;
  const examples = useMemo(
    () => (previewRows === null || columns === undefined ? {} : firstValues(columns, previewRows)),
    [previewRows, columns],
  );

  const change = useCallback(
    (next: ColumnMapping) => {
      // The store counts this as the user's change to the automatic match.
      actions.setMapping(slot, next);
      onMappingChange?.(next);
    },
    [actions, slot, onMappingChange],
  );
  const setField = useCallback(
    (key: string, column: string | null) => {
      if (mapping !== undefined) change(withFieldColumn(mapping, key, column));
    },
    [mapping, change],
  );
  const setAdditionalColumns = useCallback(
    (chosen: readonly string[]) => {
      if (mapping !== undefined && columns !== undefined) {
        change(withAdditionalColumns(mapping, chosen, columns));
      }
    },
    [mapping, columns, change],
  );
  const confirm = useCallback(
    (key: string) => {
      const column = mapping?.fields[key] ?? null;
      if (column !== null) actions.confirmMatch(slot, key, column);
    },
    [mapping, actions, slot],
  );

  if (mapped === null) return null;
  return {
    slot,
    fieldSet,
    mapped,
    model,
    examples,
    preview,
    setField,
    confirm,
    setAdditionalColumns,
  };
}
