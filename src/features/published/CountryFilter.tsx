import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";

import { Button, Checkbox, cn, formatCount, Popover, TextField } from "@/ui";

/** Props for {@link CountryFilter}. */
export interface CountryFilterProps {
  /** Countries offered as choices, in display order. */
  readonly countries: readonly string[];
  /** Currently chosen countries. */
  readonly selected: readonly string[];
  /** Number of matching published PMOs for each country under the other active filters. */
  readonly counts: ReadonlyMap<string, number>;
  /** Called with the next list of chosen countries when the user toggles or clears choices. */
  readonly onChange: (countries: readonly string[]) => void;
}

/**
 * Multi-select country filter for the Published PMOs list. Shows a popover
 * with a search box, checkboxes and per-country dataset counts.
 */
export function CountryFilter({ countries, selected, counts, onChange }: CountryFilterProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === "") return countries;
    return countries.filter((country) => country.toLowerCase().includes(needle));
  }, [countries, query]);

  const firstSelected = selected[0];
  const summary =
    selected.length === 0
      ? t`Any country`
      : selected.length === 1 && firstSelected !== undefined
        ? firstSelected
        : plural(selected.length, { one: "# country", other: "# countries" });

  function toggleCountry(country: string, checked: boolean) {
    if (checked) {
      const nextSet = new Set(selected);
      nextSet.add(country);
      const ordered = countries.filter((item) => nextSet.has(item));
      for (const item of nextSet) {
        if (!ordered.includes(item)) ordered.push(item);
      }
      onChange(ordered);
      return;
    }
    onChange(selected.filter((item) => item !== country));
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
      }}
      align="start"
      label={t`Filter by country`}
      className="w-72 p-3"
      trigger={
        <Button
          variant="secondary"
          fullWidth
          aria-label={t({
            message: `Country: ${summary}`,
            comment: "Button label for the country filter showing the current selection",
          })}
          className="justify-between border-border-strong px-3 font-normal hover:border-text-subtle"
        >
          <span className="truncate">{summary}</span>
          <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-text-muted" />
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <TextField
          type="search"
          label={t`Filter countries`}
          hideLabel
          placeholder={t`Filter countries`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {selected.length > 0 ? (
          <div className="flex items-center justify-between gap-2 border-b border-border pb-2">
            <span className="text-sm text-text-muted">
              {plural(selected.length, { one: "# selected", other: "# selected" })}
            </span>
            <Button variant="ghost" size="sm" onClick={() => onChange([])}>
              <Trans>Clear countries</Trans>
            </Button>
          </div>
        ) : null}
        {visible.length === 0 ? (
          <p className="py-3 text-center text-sm text-text-muted">
            <Trans>No matching country</Trans>
          </p>
        ) : (
          <ul className="flex max-h-60 flex-col gap-1.5 overflow-y-auto pr-1">
            {visible.map((country) => {
              const count = counts.get(country) ?? 0;
              const countText = formatCount(count);
              const isSelected = selectedSet.has(country);
              return (
                <li key={country}>
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => toggleCountry(country, checked)}
                    label={
                      <span className={cn(count === 0 && !isSelected && "text-text-muted")}>
                        <Trans>
                          {country}{" "}
                          <span className="text-sm text-text-subtle tabular-nums">
                            ({countText})
                          </span>
                        </Trans>
                      </span>
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Popover>
  );
}
