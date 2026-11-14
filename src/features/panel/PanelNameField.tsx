import type { PanelEntry } from "@/domain/draft";
import type { Notice } from "@/domain/types";
import { useActions, useSuggestions } from "@/state";
import { Button, TextField } from "@/ui";

import { findNotice } from "./panelModel";

function listNames(names: readonly string[]): string {
  const shown = names.slice(0, 4).map((name) => `"${name}"`);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(", ")} and ${more} more`;
  if (shown.length <= 1) return shown.join("");
  return `${shown.slice(0, -1).join(", ")} and ${shown.at(-1) ?? ""}`;
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
      ? "Your library sample table refers to the panel by this name, so use the same one."
      : "Letters, numbers and . _ - with no spaces. If you add a library sample table, it refers to the panel by this name.",
    entry.source === "saved"
      ? "Renaming it here changes this draft only, not the saved panel."
      : "",
  ]
    .filter((part) => part !== "")
    .join(" ");

  return (
    <div className="flex flex-col gap-2">
      <TextField
        label="Panel name"
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
          <span>From the library sample table:</span>
          {others.slice(0, 6).map((suggested) => (
            <Button
              key={suggested}
              size="sm"
              onClick={() => setName(suggested)}
              aria-label={`Use the panel name ${suggested}`}
            >
              <span className="font-mono">{suggested}</span>
            </Button>
          ))}
        </div>
      ) : null}
      {unmatched ? (
        <p className="max-w-prose text-sm text-text-muted">
          The library sample table names {panelNames.length === 1 ? "its panel" : "its panels"}{" "}
          {listNames(panelNames)}, not "{name}". Its samples link to this panel only if the names
          match.
        </p>
      ) : null}
    </div>
  );
}
