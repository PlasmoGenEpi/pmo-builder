import { plural, t } from "@lingui/core/macro";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";

import { Button, EmptyState, NumberField, formatCount, jumpToHeading } from "@/ui";

/** Common minimum read count cutoffs offered as one-press choices beside the input. */
const COMMON_MIN_READS = [10, 50, 100, 500] as const;

/** Sub-pixel slack when checking whether the jump strip has reached a scroll edge. */
const EDGE_EPSILON = 1;

interface OverflowEdges {
  readonly left: boolean;
  readonly right: boolean;
}

const NO_OVERFLOW: OverflowEdges = { left: false, right: false };

function measureOverflow(element: HTMLElement): OverflowEdges {
  const left = element.scrollLeft > EDGE_EPSILON;
  const right = element.scrollLeft + element.clientWidth < element.scrollWidth - EDGE_EPSILON;
  return { left, right };
}

/** The row of controls above the Summary and Compare views. */
export function ViewToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-2.5 gap-y-2 border-b border-border pb-3">
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
  /** Optional ref forwarded to the numeric input, for restoring focus after clearing. */
  readonly inputRef?: Ref<HTMLInputElement>;
}

/** The minimum reads for a microhaplotype to count. Worded as on the Subset tab. */
export function MinReadsField({ value, onValueChange, maxReads, inputRef }: MinReadsFieldProps) {
  const hintId = useId();
  const [resetKey, setResetKey] = useState(0);
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
    comment: "Button in the minimum reads controls meaning all microhaplotypes count",
  });

  function selectCutoff(target: number | null): void {
    const alreadyActive = target === null ? allActive : value === target;
    if (alreadyActive) {
      setResetKey((current) => current + 1);
    }
    onValueChange(target);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1.5">
        <NumberField
          key={resetKey}
          ref={inputRef}
          label={t`Minimum reads per microhaplotype`}
          aria-describedby={hintId}
          title={hint}
          layout="compact"
          integer
          min={0}
          value={value}
          onValueChange={onValueChange}
        />
        {cutoffs.length > 0 ? (
          <fieldset className="flex flex-wrap items-center gap-0.5">
            <legend className="sr-only">{t`Common minimum read counts`}</legend>
            <Button
              variant="secondary"
              size="sm"
              selected={allActive}
              aria-pressed={allActive}
              className="pr-1.5 pl-1.5 text-xs"
              onClick={() => selectCutoff(null)}
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
                  selected={active}
                  aria-pressed={active}
                  className="pr-1.5 pl-1.5 text-xs tabular-nums"
                  onClick={() => selectCutoff(cutoff)}
                >
                  {formatCount(cutoff)}
                </Button>
              );
            })}
          </fieldset>
        ) : null}
      </div>
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

/**
 * Links to the sections of a long view, each scrolling to its heading. On a
 * narrow screen they stay on one row that scrolls sideways, so they do not
 * push the data down the page.
 */
export function SectionJumps({ jumps }: { readonly jumps: readonly Jump[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState<OverflowEdges>(NO_OVERFLOW);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (element === null) return;
    const next = measureOverflow(element);
    setFade((current) =>
      current.left === next.left && current.right === next.right ? current : next,
    );
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (element === null) return undefined;
    measure();
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resizeObserver?.observe(element);
    const mutationObserver =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    mutationObserver?.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [measure]);

  return (
    <nav
      aria-label={t({
        message: "On this page",
        comment: "Name of the jump links to headings in the current view",
      })}
      className="relative max-w-full min-w-0"
    >
      <div
        ref={scrollRef}
        onScroll={measure}
        className="flex items-center gap-x-0.5 gap-y-1 max-sm:-m-0.5 max-sm:overflow-x-auto max-sm:p-0.5 sm:flex-wrap"
      >
        <span className="shrink-0 pr-0.5 text-xs text-text-subtle">
          {t({ message: "Jump to", comment: "Followed by links to the sections of the page" })}
        </span>
        {jumps.map((jump) => (
          <Button
            key={jump.id}
            variant="ghost"
            size="sm"
            className="pr-1 pl-1 text-xs"
            onClick={() => jumpToHeading(jump.id)}
          >
            {jump.label}
          </Button>
        ))}
      </div>
      <span
        aria-hidden="true"
        data-fade="left"
        data-state={fade.left ? "visible" : "hidden"}
        className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-surface via-surface/80 to-transparent opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 motion-reduce:transition-none sm:hidden"
      />
      <span
        aria-hidden="true"
        data-fade="right"
        data-state={fade.right ? "visible" : "hidden"}
        className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-surface via-surface/80 to-transparent opacity-0 transition-opacity duration-150 data-[state=visible]:opacity-100 motion-reduce:transition-none sm:hidden"
      />
    </nav>
  );
}
