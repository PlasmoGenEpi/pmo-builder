import { useId, useState, type ReactNode } from "react";

import type { SectionSummaries } from "@/domain/build";
import type { Notice, SectionId, SectionStatus } from "@/domain/types";
import { useBuildState, useOverallState, useSectionState } from "@/state";
import { Button, Callout, Card, Stat, StatusBadge, cn, type CalloutTone } from "@/ui";

import { crossSectionNotices, useCrossSectionOwner } from "./crossSection";
import { groupNotices, type NoticeGroup } from "./noticeGroups";

/** One number in the result. */
export interface ResultStat {
  readonly label: string;
  readonly value: number | string;
  /** A short line under the number. */
  readonly hint?: string;
}

/** Props for {@link SectionResult}. */
export interface SectionResultProps<S extends SectionId> {
  /** The section whose latest build to show. */
  readonly section: S;
  /** Turns the section's summary into the numbers to show. Called only when there is a summary. */
  readonly stats?: (summary: SectionSummaries[S]) => readonly ResultStat[];
  /** Heading. Default "Result". */
  readonly title?: string;
  /** Heading level. Default 2. */
  readonly headingLevel?: 2 | 3;
  /** What to say while nothing has been entered. Default: a general line. */
  readonly emptyMessage?: ReactNode;
  /**
   * Whether to show problems found by comparing this section's tables with
   * the others (a library sample whose specimen is not in the specimen
   * table, say), under their own heading. Default `true`. A notice that
   * points at two sections shown on one page appears once, beside the
   * section it names first.
   */
  readonly showCrossSection?: boolean;
}

const STATUS_LINE: Readonly<Record<Exclude<SectionStatus, "empty">, string>> = {
  ready: "This part is ready to go into the PMO.",
  incomplete: "Something this part needs is missing. See below.",
  error: "There are problems to fix before this part can go into the PMO. See below.",
};

const TONE: Readonly<Record<Notice["severity"], CalloutTone>> = {
  error: "error",
  warning: "warning",
  info: "info",
};

const NOUN: Readonly<Record<Notice["severity"], [string, string]>> = {
  error: ["problem", "problems"],
  warning: ["warning", "warnings"],
  info: ["note", "notes"],
};

/** How many messages of a group show before "Show all". */
const FIRST_SHOWN = 1;

function NoticeGroupCallout({ group }: { readonly group: NoticeGroup }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const count = group.notices.length;
  const first = group.notices[0];
  if (first === undefined) return null;
  if (count === 1) {
    return <Callout tone={TONE[group.severity]}>{first.message}</Callout>;
  }
  const [, many] = NOUN[group.severity];
  const shown = expanded ? group.notices : group.notices.slice(0, FIRST_SHOWN);
  return (
    <Callout
      tone={TONE[group.severity]}
      title={`${count} similar ${many}`}
      action={
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? "Show fewer" : `Show all ${count}`}
        </Button>
      }
    >
      <ul id={listId} className="flex list-disc flex-col gap-1 pl-5 marker:text-text-subtle">
        {shown.map((notice) => (
          <li key={notice.message}>{notice.message}</li>
        ))}
        {expanded ? null : (
          <li className="list-none text-text-muted">and {count - FIRST_SHOWN} more like this.</li>
        )}
      </ul>
    </Callout>
  );
}

/**
 * The latest build of one section: its status, its summary numbers and its
 * notices, errors first, then the problems found by comparing its tables
 * with the other sections' (see `showCrossSection`). Many notices of one kind collapse into one message
 * with a count. While a rebuild runs the previous result stays, marked
 * "Updating", so nothing jumps.
 *
 * @example
 * <SectionResult
 *   section="specimens"
 *   stats={(summary) => [{ label: "Specimens", value: summary.specimens }]}
 * />
 */
export function SectionResult<S extends SectionId>({
  section,
  stats,
  title = "Result",
  headingLevel = 2,
  emptyMessage = "Nothing here yet. Add a table above to see what goes into the PMO.",
  showCrossSection = true,
}: SectionResultProps<S>) {
  const view = useSectionState(section);
  const build = useBuildState();
  const overall = useOverallState();
  const isMine = useCrossSectionOwner(section);
  const crossHeadingId = useId();
  const headingId = useId();
  const Heading = headingLevel === 2 ? "h2" : "h3";
  const SubHeading = headingLevel === 2 ? "h3" : "h4";
  const updating = build.phase === "pending";
  const status: SectionStatus = view?.status ?? "empty";
  const numbers =
    view?.summary === null || view === null || stats === undefined ? [] : stats(view.summary);
  const groups = groupNotices(view?.notices ?? []);
  const cross = showCrossSection
    ? groupNotices(
        crossSectionNotices(overall?.notices ?? [], section, view?.notices ?? []).filter(isMine),
      )
    : [];

  return (
    <Card as="section" aria-labelledby={headingId} aria-busy={updating || undefined}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <Heading id={headingId} className="text-lg font-semibold tracking-tight text-text">
              {title}
            </Heading>
            {view === null ? null : <StatusBadge status={status} />}
          </div>
          <span
            className={cn(
              "flex items-center gap-1.5 text-sm text-text-muted transition-opacity duration-150",
              updating ? "opacity-100" : "opacity-0",
            )}
            aria-hidden={!updating}
          >
            <span className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
            Updating
          </span>
        </div>
        <div className={cn("flex flex-col gap-5 transition-opacity", updating && "opacity-70")}>
          <p className="text-base text-text-muted" aria-live="polite">
            {view === null
              ? "Working out the result."
              : status === "empty"
                ? emptyMessage
                : STATUS_LINE[status]}
          </p>
          {numbers.length > 0 ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {numbers.map((number) => (
                <Stat
                  key={number.label}
                  label={number.label}
                  value={number.value}
                  hint={number.hint}
                />
              ))}
            </div>
          ) : null}
          {build.phase === "failed" ? (
            <Callout tone="error" title="The result could not be worked out">
              {build.message} Reload the page to try again.
            </Callout>
          ) : null}
          {groups.length > 0 ? (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <NoticeGroupCallout key={`${group.severity}:${group.code}`} group={group} />
              ))}
            </div>
          ) : null}
          {cross.length > 0 ? (
            <section aria-labelledby={crossHeadingId} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <SubHeading id={crossHeadingId} className="text-base font-semibold text-text">
                  Found by comparing tables
                </SubHeading>
                <p className="text-sm text-text-muted">
                  These come from checking this part against the other steps. Fix them here or on
                  the step they name.
                </p>
              </div>
              {cross.map((group) => (
                <NoticeGroupCallout key={`cross:${group.severity}:${group.code}`} group={group} />
              ))}
            </section>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
