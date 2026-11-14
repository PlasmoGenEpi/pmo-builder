import { Plus, X } from "lucide-react";
import { useId } from "react";

import { createKeyValue, type KeyValueEntry } from "@/domain/draft";
import { Button, IconButton, TextField } from "@/ui";

import { checkExtraEntry } from "./checks";
import { useBufferedText } from "./useBufferedText";

/** Props for {@link ExtraDetails}. */
export interface ExtraDetailsProps {
  readonly entries: readonly KeyValueEntry[];
  /** Changes the list with a recipe applied to the stored entries, so edits never overwrite each other. */
  readonly onUpdate: (
    recipe: (entries: readonly KeyValueEntry[]) => readonly KeyValueEntry[],
  ) => void;
  /** The record's own field names, which a detail may not reuse. */
  readonly fieldKeys: readonly string[];
}

function EntryRow({
  entry,
  index,
  problem,
  onCommit,
  onRemove,
}: {
  readonly entry: KeyValueEntry;
  readonly index: number;
  readonly problem: string | null;
  readonly onCommit: (change: Partial<Pick<KeyValueEntry, "key" | "value">>) => void;
  readonly onRemove: () => void;
}) {
  const key = useBufferedText({ value: entry.key, commit: (next) => onCommit({ key: next }) });
  const value = useBufferedText({
    value: entry.value,
    commit: (next) => onCommit({ value: next }),
  });
  const number = index + 1;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]">
      <TextField
        label={`Name of detail ${number}`}
        hideLabel
        placeholder="Name, such as funding"
        mono
        value={key.value}
        onChange={(event) => key.onChange(event.target.value)}
        onBlur={key.flush}
        error={problem ?? undefined}
        autoComplete="off"
        spellCheck={false}
      />
      <TextField
        label={`Value of detail ${number}`}
        hideLabel
        placeholder="Value"
        value={value.value}
        onChange={(event) => value.onChange(event.target.value)}
        onBlur={value.flush}
        autoComplete="off"
        className="col-start-1 sm:col-start-auto"
      />
      <IconButton
        icon={X}
        label={`Remove detail ${number}`}
        onClick={onRemove}
        className="col-start-2 row-start-1 sm:col-start-auto"
      />
    </li>
  );
}

/**
 * Free details the PMO format does not name, as name and value pairs. Each
 * is written into the PMO under its name.
 */
export function ExtraDetails({ entries, onUpdate, fieldKeys }: ExtraDetailsProps) {
  const headingId = useId();
  const keys = new Set(fieldKeys);
  const update = (id: string, change: Partial<Pick<KeyValueEntry, "key" | "value">>): void =>
    onUpdate((current) =>
      // oxlint-disable-next-line oxc/no-map-spread -- entries are immutable state; items must be new objects
      current.map((entry) => (entry.id === id ? { ...entry, ...change } : entry)),
    );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h4 id={headingId} className="text-base font-medium text-text">
          Other details
        </h4>
        <p className="text-sm text-text-muted">
          Anything else worth keeping, as a name and a value. Each is added to the PMO under its
          name.
        </p>
      </div>
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-3">
          {entries.map((entry, index) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              index={index}
              problem={checkExtraEntry(entry, entries, keys)}
              onCommit={(change) => update(entry.id, change)}
              onRemove={() =>
                onUpdate((current) => current.filter((other) => other.id !== entry.id))
              }
            />
          ))}
        </ul>
      ) : null}
      <div>
        <Button
          size="sm"
          icon={Plus}
          onClick={() => onUpdate((current) => [...current, createKeyValue()])}
        >
          Add a detail
        </Button>
      </div>
    </section>
  );
}
