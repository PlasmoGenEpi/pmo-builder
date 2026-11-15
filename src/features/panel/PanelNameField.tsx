import { plural, t } from "@lingui/core/macro";

import type { PanelEntry } from "@/domain/draft";
import type { Notice } from "@/domain/types";
import { useActions, useSuggestions } from "@/state";
import { intlLocale } from "@/i18n/languages";
import { Button, TextField } from "@/ui";

import { findNotice } from "./panelModel";

/** Up to four names in quotes for a sentence: "a", "b" and "c", or "a", "b", "c", "d" and 2 more. */
function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 4).map((name) => `"${name}"`);
  const more = names.length - shown.length;
  if (more > 0) {
    const shownNames = shown.join(", ");
    return plural(more, { one: `${shownNames} and # more`, other: `${shownNames} and # more` });
  }
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(shown);
}

/** Props for {@link PanelNameField}. */
export interface PanelNameFieldProps {
  readonly entry: PanelEntry;
  /** This panel's notices from the latest build. */
  readonly notices: readonly Notice[];
}

/**
 * The panel's name. Offers the panel names the library sample table uses,
 * and says gently when the name typed is not one of them. For a panel taken
 * from the library it renames the panel in this draft only.
 */
export function PanelNameField({ entry, notices }: PanelNameFieldProps) {
  const actions = useActions();
  const { panelNames } = useSuggestions();
  const current = entry.source === "saved" ? (entry.saved?.name ?? "") : entry.name;
  const name = current.trim();
  const problem = findNotice(notices, ["panel/missing-name", "panel/invalid-name"]);
  const others = panelNames.filter((suggested) => suggested !== name);
  const unmatched = name !== "" && panelNames.length > 0 && !panelNames.includes(name);
  const tableNames = listNames(panelNames);

  const setName = (value: string) =>
    actions.updateItem({
      list: "panels",
      id: entry.id,
      recipe: (panel) =>
        panel.source === "saved" && panel.saved !== null
          ? { ...panel, saved: { ...panel.saved, name: value } }
          : { ...panel, name: value },
    });

  const hint = [
    panelNames.length > 0
      ? t`Your library sample table refers to the panel by this name, so use the same one.`
      : t`Letters, numbers and . _ - with no spaces. If you add a library sample table, it refers to the panel by this name.`,
    entry.source === "saved"
      ? t`Renaming it here changes this draft only, not the saved panel.`
      : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label={t`Panel name`}
        required
        mono
        value={current}
        autoComplete="off"
        spellCheck={false}
        hint={hint}
        error={problem?.message ?? null}
        onChange={(event) => setName(event.target.value)}
        className="sm:max-w-sm"
      />
      {others.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-text-muted">
          <span>{t`From the library sample table:`}</span>
          {others.slice(0, 6).map((suggested) => (
            <Button
              key={suggested}
              size="sm"
              onClick={() => setName(suggested)}
              aria-label={t`Use the panel name ${suggested}`}
            >
              <span className="font-mono">{suggested}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {unmatched ? (
        <p className="max-w-prose text-sm text-text-muted">
          {plural(panelNames.length, {
            one: `The library sample table names its panel ${tableNames}, not "${name}". Its samples link to this panel only if the names match.`,
            other: `The library sample table names its panels ${tableNames}, not "${name}". Its samples link to this panel only if the names match.`,
          })}
        </p>
      ) : null}
    </div>
  );
}
