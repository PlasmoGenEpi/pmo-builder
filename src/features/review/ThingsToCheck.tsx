import { CircleCheck } from "lucide-react";
import { StepLink } from "@/app/StepLink";
import { useId, useState } from "react";

import { getStep } from "@/app/steps";
import type { Notice, SectionId } from "@/domain/types";
import { groupNotices, type NoticeGroup } from "@/features/shared";
import { Badge, Button, Callout, Card, type CalloutTone } from "@/ui";

import { noticeKindTitle } from "./noticeKinds";

const TONE: Readonly<Record<Notice["severity"], CalloutTone>> = {
  error: "error",
  warning: "warning",
  info: "info",
};

/** How many messages of a group show before "Show all". */
const FIRST_SHOWN = 2;

/** Most step links under one message. */
const MAX_LINKS = 2;

function linkedSections(notice: Notice): readonly SectionId[] {
  return (notice.sections ?? []).slice(0, MAX_LINKS);
}

/** The steps every notice of the group points at, when they all point at the same ones. */
function sharedSections(group: NoticeGroup): readonly SectionId[] | null {
  const [first, ...rest] = group.notices;
  if (first === undefined) return null;
  const key = linkedSections(first).join(",");
  return rest.every((notice) => linkedSections(notice).join(",") === key)
    ? linkedSections(first)
    : null;
}

function FixLinks({ sections }: { readonly sections: readonly SectionId[] }) {
  if (sections.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {sections.map((section) => (
        <StepLink key={section} step={section} variant="arrow">
          Fix on {getStep(section).title}
        </StepLink>
      ))}
    </span>
  );
}

function NoticeItem({
  notice,
  withLinks,
}: {
  readonly notice: Notice;
  readonly withLinks: boolean;
}) {
  return (
    <li className="flex flex-col gap-1">
      <span className="break-words">{notice.message}</span>
      {notice.path === undefined || notice.path === "" ? null : (
        <span className="text-sm break-all text-text-muted">
          Details: place in the PMO file <code className="font-mono">{notice.path}</code>
        </span>
      )}
      {withLinks ? <FixLinks sections={linkedSections(notice)} /> : null}
    </li>
  );
}

function GroupCallout({ group }: { readonly group: NoticeGroup }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const total = group.notices.length;
  const shown = expanded ? group.notices : group.notices.slice(0, FIRST_SHOWN);
  const hidden = total - shown.length;
  const shared = sharedSections(group);
  return (
    <Callout
      tone={TONE[group.severity]}
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          {noticeKindTitle(group)}
          {total > 1 ? <Badge>{total}</Badge> : null}
        </span>
      }
      action={
        total > FIRST_SHOWN || (shared !== null && shared.length > 0) ? (
          <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {shared === null ? null : <FixLinks sections={shared} />}
            {total > FIRST_SHOWN ? (
              <Button
                size="sm"
                variant="ghost"
                aria-expanded={expanded}
                aria-controls={listId}
                onClick={() => setExpanded((open) => !open)}
              >
                {expanded ? "Show fewer" : `Show all ${total}`}
              </Button>
            ) : null}
          </span>
        ) : undefined
      }
    >
      <ul id={listId} className="flex flex-col gap-3">
        {shown.map((notice) => (
          <NoticeItem key={notice.message} notice={notice} withLinks={shared === null} />
        ))}
        {hidden > 0 ? (
          <li className="text-text-muted">
            and {hidden} more like {hidden === 1 ? "this" : "these"}.
          </li>
        ) : null}
      </ul>
    </Callout>
  );
}

/** Props for {@link ThingsToCheck}. */
export interface ThingsToCheckProps {
  readonly notices: readonly Notice[];
  /** Whether a PMO was built. Only then can "nothing to check" be said. */
  readonly built: boolean;
}

/**
 * Notices from the merge, the schema check and the integrity check, and the
 * warnings of the sections that go into the PMO: errors first, grouped by
 * kind with a count, each linking to the step where it can be fixed.
 */
export function ThingsToCheck({ notices, built }: ThingsToCheckProps) {
  const groups = groupNotices(notices);
  if (groups.length === 0 && !built) return null;
  return (
    <Card as="section" aria-labelledby="review-check-heading">
      <div className="flex flex-col gap-4">
        <h2 id="review-check-heading" className="text-lg font-semibold tracking-tight text-text">
          Things to check
        </h2>
        {groups.length === 0 ? (
          <p className="flex items-center gap-2 text-base text-text-muted">
            <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" />
            Nothing to check. The PMO matches the format and every table links up.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {groups.map((group) => (
              <GroupCallout key={`${group.severity}:${group.code}`} group={group} />
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
