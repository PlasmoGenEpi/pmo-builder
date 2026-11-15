import { t } from "@lingui/core/macro";
import { useId, useMemo, useState } from "react";

import { Button, Checkbox, TextField, formatCount } from "@/ui";

/** One name that can be ticked. */
export interface ChecklistItem {
  readonly name: string;
  /** Shown after the name, such as "2 library samples". */
  readonly detail?: string;
}

/** Props for {@link NameChecklist}. */
export interface NameChecklistProps {
  /** Names the list for screen readers, such as "Specimens". */
  readonly label: string;
  readonly items: readonly ChecklistItem[];
  readonly selected: readonly string[];
  readonly onChange: (selected: string[]) => void;
}

/** The most names drawn at once. A search narrows the rest. */
const MAX_SHOWN = 300;

/** A searchable list of names to tick, for choosing specimens or targets. */
export function NameChecklist({ label, items, selected, onChange }: NameChecklistProps) {
  const [search, setSearch] = useState("");
  const listId = useId();
  const chosen = useMemo(() => new Set(selected), [selected]);
  const needle = search.trim().toLowerCase();
  const matching = useMemo(
    () =>
      needle === "" ? items : items.filter((item) => item.name.toLowerCase().includes(needle)),
    [items, needle],
  );
  const shown = matching.slice(0, MAX_SHOWN);
  const selectedCount = formatCount(selected.length);
  const totalCount = formatCount(items.length);

  function toggle(name: string, on: boolean): void {
    const next = new Set(chosen);
    if (on) next.add(name);
    else next.delete(name);
    onChange(items.filter((item) => next.has(item.name)).map((item) => item.name));
  }

  function setMatching(on: boolean): void {
    const next = new Set(chosen);
    for (const item of matching) {
      if (on) next.add(item.name);
      else next.delete(item.name);
    }
    onChange(items.filter((item) => next.has(item.name)).map((item) => item.name));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <TextField
          label={t`Search`}
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-controls={listId}
          className="sm:max-w-xs sm:flex-1"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setMatching(true)}>
            {needle === "" ? t`Tick all` : t`Tick all found`}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMatching(false)}>
            {needle === "" ? t`Untick all` : t`Untick all found`}
          </Button>
        </div>
      </div>
      <p className="text-sm text-text-muted" aria-live="polite">
        {t`${selectedCount} of ${totalCount} ticked`}
      </p>
      <fieldset
        id={listId}
        className="flex max-h-80 flex-col gap-2 overflow-y-auto rounded-md border border-border p-3"
      >
        <legend className="sr-only">{label}</legend>
        {shown.map((item) => (
          <Checkbox
            key={item.name}
            label={<span className="break-all">{item.name}</span>}
            description={item.detail}
            checked={chosen.has(item.name)}
            onCheckedChange={(on) => toggle(item.name, on)}
          />
        ))}
        {matching.length === 0 ? (
          <p className="text-sm text-text-muted">{t`Nothing matches the search.`}</p>
        ) : null}
        {matching.length > MAX_SHOWN ? (
          <p className="text-sm text-text-muted">{t`Search to see the others.`}</p>
        ) : null}
      </fieldset>
    </div>
  );
}
