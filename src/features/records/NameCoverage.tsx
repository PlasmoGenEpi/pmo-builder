import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleCheck, Plus } from "lucide-react";

import { Button, Callout } from "@/ui";

/** How many missing names to list before "and N more". */
const SHOWN = 8;

/** Props for {@link NameCoverage}. */
export interface NameCoverageProps {
  /** Names another table uses, in table order. */
  readonly referenced: readonly string[];
  /** Names of the records on this page. */
  readonly defined: readonly string[];
  /**
   * Said when every name has a record, as one whole sentence, such as
   * "Every sequencing run the library sample table names has a record here."
   */
  readonly allNamed: string;
  /**
   * The title when some names have no record, worded with `plural`, such as
   * "The library sample table names # sequencing runs with no record here".
   */
  readonly missingTitle: (count: number) => string;
  /** Adds a record for each name given. Leave out where records cannot be added (file mode). */
  readonly onCreate?: (names: readonly string[]) => void;
}

/** Names in `referenced` that `defined` lacks, in order. */
export function missingNames(
  referenced: readonly string[],
  defined: readonly string[],
): readonly string[] {
  const known = new Set(defined.map((name) => name.trim()));
  return referenced.filter((name) => !known.has(name.trim()));
}

/**
 * Compares the names another table uses with the records on this page, says
 * which have no record yet, and offers to add one for each.
 */
export function NameCoverage({
  referenced,
  defined,
  allNamed,
  missingTitle,
  onCreate,
}: NameCoverageProps) {
  if (referenced.length === 0) return null;
  const missing = missingNames(referenced, defined);
  if (missing.length === 0) {
    return (
      <p className="flex items-start gap-1.5 text-base text-text-muted">
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />
        <span>{allNamed}</span>
      </p>
    );
  }
  const shown = missing.slice(0, SHOWN);
  const more = missing.length - shown.length;
  const title = missingTitle(missing.length);
  const onlyName = missing[0] ?? "";
  const shownNames = shown.join(", ");
  return (
    <Callout
      tone="info"
      title={title}
      action={
        onCreate === undefined ? undefined : (
          <Button size="sm" icon={Plus} onClick={() => onCreate(missing)}>
            {missing.length === 1 ? t`Add ${onlyName}` : t`Add a record for each`}
          </Button>
        )
      }
    >
      <p>
        {more > 0 ? (
          <Trans>
            <span className="font-mono text-sm break-words">{shownNames}</span> and {more} more
          </Trans>
        ) : (
          <span className="font-mono text-sm break-words">{shownNames}</span>
        )}
      </p>
    </Callout>
  );
}
