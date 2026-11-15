import { t } from "@lingui/core/macro";
import { FileSpreadsheet, Keyboard } from "lucide-react";
import type { ReactNode } from "react";

import type { EntryMode } from "@/domain/draft";
import { SegmentedControl, type Segment } from "@/ui";

const SEGMENTS: readonly Segment<EntryMode>[] = [
  { value: "manual", label: t`Type it in`, icon: Keyboard },
  { value: "table", label: t`From a file`, icon: FileSpreadsheet },
];

/** Props for {@link EntryModeSwitch}. */
export interface EntryModeSwitchProps {
  /** What the switch chooses for, such as "How to enter projects". */
  readonly label: string;
  readonly mode: EntryMode;
  readonly onModeChange: (mode: EntryMode) => void;
  /** Whether anything was typed in. */
  readonly manualHasContent: boolean;
  /** Whether a file was added. */
  readonly tableHasContent: boolean;
  /** The typed-in form or list. */
  readonly manual: ReactNode;
  /** The file import. */
  readonly table: ReactNode;
  /** A sentence after the switch, such as who the file is for. */
  readonly hint?: ReactNode;
}

/**
 * Chooses between typing records in and importing them from a file. Both
 * stay in the draft, so switching never loses either; only the chosen one
 * goes into the PMO, and the switch says so when the other holds something.
 */
export function EntryModeSwitch({
  label,
  mode,
  onModeChange,
  manualHasContent,
  tableHasContent,
  manual,
  table,
  hint,
}: EntryModeSwitchProps) {
  const otherHasContent = mode === "manual" ? tableHasContent : manualHasContent;
  const note = otherHasContent
    ? mode === "manual"
      ? t`Your file is kept, but only what you type here goes into the PMO.`
      : t`What you typed is kept, but only the file goes into the PMO.`
    : null;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <SegmentedControl
          label={label}
          segments={SEGMENTS}
          value={mode}
          onValueChange={onModeChange}
        />
        {hint === undefined && note === null ? null : (
          <p className="text-sm text-text-muted">
            {hint}
            {hint !== undefined && note !== null ? " " : null}
            {note}
          </p>
        )}
      </div>
      {mode === "manual" ? manual : table}
    </div>
  );
}
