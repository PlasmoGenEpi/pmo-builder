/**
 * Which "similar name" matches the user has confirmed.
 *
 * Confirmations are kept in the draft, with each table (see
 * `MappedTable.confirmedMatches`), so they are saved and restored with it
 * and hold in every tab. A confirmation names one field and one column of
 * one table; choosing another column or importing another file makes it
 * stale, and the match is then worth checking again.
 */
import { useCallback, useMemo } from "react";

import { listFilledSlots } from "@/domain/draft";
import { useActions, useDraft } from "@/state";

/** The key of one confirmation. */
export function confirmationKey(tableId: string, fieldKey: string, column: string): string {
  return JSON.stringify([tableId, fieldKey, column]);
}

/** The confirmations of one table, as keys made with {@link confirmationKey}. */
export function confirmationKeys(
  tableId: string,
  confirmed: Readonly<Record<string, string>> | undefined,
): ReadonlySet<string> {
  return new Set(
    Object.entries(confirmed ?? {}).map(([fieldKey, column]) =>
      confirmationKey(tableId, fieldKey, column),
    ),
  );
}

/**
 * The confirmed matches of every table in the draft, and a function that
 * confirms one. Prefer `useColumnMatching`, which reads one slot's.
 */
export function useConfirmations(): {
  readonly confirmed: ReadonlySet<string>;
  readonly confirm: (tableId: string, fieldKey: string, column: string) => void;
} {
  const draft = useDraft();
  const actions = useActions();
  const filled = useMemo(() => listFilledSlots(draft), [draft]);
  const confirmed = useMemo(
    () =>
      new Set(
        filled.flatMap(({ table }) => [
          ...confirmationKeys(table.table.id, table.confirmedMatches),
        ]),
      ),
    [filled],
  );
  const confirm = useCallback(
    (tableId: string, fieldKey: string, column: string) => {
      const target = filled.find(({ table }) => table.table.id === tableId);
      if (target !== undefined) actions.confirmMatch(target.slot, fieldKey, column);
    },
    [filled, actions],
  );
  return { confirmed, confirm };
}
