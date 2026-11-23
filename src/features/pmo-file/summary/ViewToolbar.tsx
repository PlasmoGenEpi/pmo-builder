import { plural, t } from "@lingui/core/macro";
import { useId, type ReactNode } from "react";

import { Button, EmptyState, NumberField, cn, formatCount, jumpToHeading } from "@/ui";

/** Common minimum read count cutoffs offered as one-press choices beside the input. */
const COMMON_MIN_READS = [10, 50, 100, 500] as const;

const ACTIVE_CUTOFF_CLASS =
  "border-accent bg-accent-subtle font-semibold text-accent-text hover:border-accent hover:bg-accent-subtle";

/** The row of controls above the Summary and Compare views. */
export function ViewToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-4 gap-y-2 border-b border-border pb-3">
      {children}
    </div>
  );
}

/** Props for {@link MinReadsField}. */
export interface MinReadsFieldProps {
  readonly value: number | null;
  readonly onValueChange: (value: number | null) => void;
  /** The most reads any microhaplotype has in what is shown, or `null` when unknown. */
  readonly maxReads: number | null;
}

/** The minimum reads for a microhaplotype to count. Worded as on the Subset tab. */
export function MinReadsField({ value, onValueChange, maxReads }: MinReadsFieldProps) {
  const hintId = useId();
  const mostReads = maxReads !== null && maxReads > 0 ? formatCount(maxReads) : null;
  const hint =
    mostReads === null
      ? t`Leave empty to count them all.`
      : t`Leave empty to count them all. The most in this file is ${mostReads}.`;
  const cutoffs =
    maxReads === null ? COMMON_MIN_READS : COMMON_MIN_READS.filter((cutoff) => cutoff <= maxReads);
  const allActive = value === null || value === 0;
  const allLabel = t({
    message: "All",
    comment: "Placeholder in the minimum reads input when empty, meaning all microhaplotypes count",
  });

  return (
    <div className="flex flex-col gap-1.5">
      <NumberField
        label={t`Minimum reads per microhaplotype`}
        aria-describedby={hintId}
        title={hint}
        placeholder={allLabel}
        layout="compact"
        integer
        min={0}
        value={value}
        onValueChange={onValueChange}
      />
      {cutoffs.length > 0 ? (
        <fieldset className="flex flex-wrap items-center gap-1">
          <legend className="sr-only">{t`Common minimum read counts`}</legend>
          <Button
            variant="secondary"
            size="sm"
            aria-pressed={allActive}
            className={cn(allActive && ACTIVE_CUTOFF_CLASS)}
            onClick={() => onValueChange(null)}
          >
            {allLabel}
          </Button>
          {cutoffs.map((cutoff) => {
            const active = value === cutoff;
            return (
              <Button
                key={cutoff}
                variant="secondary"
                size="sm"
                aria-pressed={active}
                className={cn("tabular-nums", active && ACTIVE_CUTOFF_CLASS)}
                onClick={() => onValueChange(cutoff)}
              >
                {formatCount(cutoff)}
              </Button>
            );
          })}
        </fieldset>
      ) : null}
      <p id={hintId} className="text-xs text-text-muted">
        {hint}
      </p>
    </div>
  );
}

/** Props for {@link NoReadsAboveMinimum}. */
export interface NoReadsAboveMinimumProps {
  /** The active minimum read threshold that excluded every microhaplotype. */
  readonly minReads: number;
  /** The most reads any microhaplotype has in the working PMO, or `null` when unknown. */
  readonly maxReads: number | null;
  readonly onClear: () => void;
}

/** Shown when the minimum read count leaves no microhaplotypes to display. */
export function NoReadsAboveMinimum({ minReads, maxReads, onClear }: NoReadsAboveMinimumProps) {
  const minimum = formatCount(minReads);
  const mostReads = maxReads === null ? "" : formatCount(maxReads);
  return (
    <EmptyState
      title={plural(minReads, {
        one: `No microhaplotype has at least ${minimum} read`,
        other: `No microhaplotype has at least ${minimum} reads`,
      })}
      description={
        maxReads !== null && maxReads > 0 && maxReads < minReads
          ? plural(maxReads, {
              one: `The most in this file is ${mostReads} read. Lower the minimum or clear it to see all microhaplotypes.`,
              other: `The most in this file is ${mostReads} reads. Lower the minimum or clear it to see all microhaplotypes.`,
            })
          : t`Lower the minimum or clear it to see all microhaplotypes.`
      }
      action={
        <Button variant="primary" onClick={onClear}>
          {t`Clear minimum reads`}
        </Button>
      }
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
