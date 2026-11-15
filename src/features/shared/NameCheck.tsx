import { plural, t } from "@lingui/core/macro";
import { CircleCheck, TriangleExclamationPoint } from "lucide-react";

import { StepLink } from "@/app/StepLink";
import { getStep, type StepId } from "@/app/steps";

/** How many names to list before "and N more". */
const SHOWN = 6;

/** Names joined for a sentence, with "and N more" past the first `count`. */
export function listNames(names: readonly string[], count = SHOWN): string {
  const shown = names.slice(0, count);
  const more = names.length - shown.length;
  const shownNames = shown.join(", ");
  return more > 0
    ? plural(more, { one: `${shownNames} and # more`, other: `${shownNames} and # more` })
    : shownNames;
}

/** Props for {@link NameCheck}. */
export interface NameCheckProps {
  /** What the names are, such as "Panels named in this table". */
  readonly label: string;
  /** The names this table uses, or `null` while they load. */
  readonly names: readonly string[] | null;
  /** What to say when the table names none, such as "No panel column is matched." */
  readonly noneMessage: string;
  /** The step the names must match. */
  readonly stepId: StepId;
  /** The names on that step, or `null` when the step has none yet. */
  readonly known: readonly string[] | null;
  /** What the step holds, plural, such as "panels". */
  readonly things: string;
  /** Said after "The ... step has no ... yet." when the step is empty, such as "Add them there to keep the link." */
  readonly emptyAdvice?: string;
}

/**
 * One kind of name a table refers to, the names, and whether each is found
 * on the step it must match, with a link to that step. Status is said in
 * words as well as an icon. Renders a term and its description, so place it
 * in a `<dl>`.
 */
export function NameCheck({
  label,
  names,
  noneMessage,
  stepId,
  known,
  things,
  emptyAdvice,
}: NameCheckProps) {
  const stepTitle = getStep(stepId).title;
  const link = <StepLink step={stepId} className="whitespace-nowrap" />;
  let check: { readonly ok: boolean; readonly text: string } | null = null;
  if (names !== null && names.length > 0) {
    if (known === null || known.length === 0) {
      const empty = t`The ${stepTitle} step has no ${things} yet.`;
      check = {
        ok: false,
        text: emptyAdvice === undefined ? empty : `${empty} ${emptyAdvice}`,
      };
    } else {
      const knownSet = new Set(known);
      const missing = names.filter((name) => !knownSet.has(name));
      const missingNames = listNames(missing);
      check =
        missing.length === 0
          ? { ok: true, text: t`All found on the ${stepTitle} step.` }
          : { ok: false, text: t`Not on the ${stepTitle} step: ${missingNames}.` };
    }
  }
  const Icon = check?.ok === true ? CircleCheck : TriangleExclamationPoint;
  return (
    <div className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm font-medium text-text-muted">{label}</dt>
      <dd className="flex flex-col gap-1">
        {names === null ? (
          <span className="text-base text-text-muted">{t`Reading the table.`}</span>
        ) : names.length === 0 ? (
          <span className="text-base text-text-muted">{noneMessage}</span>
        ) : (
          <span className="font-mono text-base break-words text-text">{listNames(names)}</span>
        )}
        {check === null ? null : (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base">
            <span className="flex items-start gap-1.5">
              <Icon
                aria-hidden="true"
                className={
                  check.ok
                    ? "mt-0.5 size-4 shrink-0 text-success"
                    : "mt-0.5 size-4 shrink-0 text-warning"
                }
              />
              <span className={check.ok ? "text-text" : "text-warning-text"}>{check.text}</span>
            </span>
            {link}
          </span>
        )}
      </dd>
    </div>
  );
}
