import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { Button, NumberField, jumpToHeading } from "@/ui";

/** The row of controls above the Summary and Compare views. */
export function ViewToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border pb-3">
      {children}
    </div>
  );
}

/** Props for {@link MinReadsField}. */
export interface MinReadsFieldProps {
  readonly value: number | null;
  readonly onValueChange: (value: number | null) => void;
}

/** The minimum reads for a microhaplotype to count. Worded as on the Subset tab. */
export function MinReadsField({ value, onValueChange }: MinReadsFieldProps) {
  const hint = t`Leave empty to count them all.`;
  return (
    <NumberField
      label={t`Minimum reads per microhaplotype`}
      hint={hint}
      title={hint}
      placeholder={t({
        message: "All",
        comment:
          "Placeholder in the minimum reads input when empty, meaning all microhaplotypes count",
      })}
      layout="compact"
      integer
      min={0}
      value={value}
      onValueChange={onValueChange}
    />
  );
}

/** A section to jump to: the id of its heading and a short name. */
export interface Jump {
  readonly id: string;
  readonly label: string;
}

/** Links to the sections of a long view, each scrolling to its heading. */
export function SectionJumps({ jumps }: { readonly jumps: readonly Jump[] }) {
  return (
    <nav
      aria-label={t({
        message: "On this page",
        comment: "Name of the jump links to headings in the current view",
      })}
      className="flex flex-wrap items-center gap-x-1 gap-y-1"
    >
      <span className="pr-1.5 text-sm text-text-subtle">
        {t({ message: "Jump to", comment: "Followed by links to the sections of the page" })}
      </span>
      {jumps.map((jump) => (
        <Button key={jump.id} variant="ghost" size="sm" onClick={() => jumpToHeading(jump.id)}>
          {jump.label}
        </Button>
      ))}
    </nav>
  );
}
