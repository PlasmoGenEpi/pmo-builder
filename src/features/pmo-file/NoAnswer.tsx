import { t } from "@lingui/core/macro";

import { unreachable } from "@/domain/draft";
import { Callout } from "@/ui";

/** Why a tab got nothing from the working PMO. */
export type NoAnswerReason = "not-open" | "no-subset" | "failed";

/** Props for {@link NoAnswer}. */
export interface NoAnswerProps {
  readonly reason: NoAnswerReason;
  /** What to do when no file is open, as one sentence. */
  readonly notOpen: string;
  /** What to do when the subset was asked for and none has been made. */
  readonly noSubset: string;
  /** What failed and what to do, or `null` when the tab says so where it happened. */
  readonly failed: { readonly title: string; readonly body: string } | null;
}

/**
 * Why a tab of My PMO file has nothing to show, in the tab's own words. The
 * engine's own message for a failure is never shown: it is not written for
 * the people using the app.
 */
export function NoAnswer({ reason, notOpen, noSubset, failed }: NoAnswerProps) {
  switch (reason) {
    case "not-open":
      return (
        <Callout tone="info" live title={t`No file is open`}>
          {notOpen}
        </Callout>
      );
    case "no-subset":
      return (
        <Callout tone="info" live title={t`No subset has been made yet`}>
          {noSubset}
        </Callout>
      );
    case "failed":
      return failed === null ? null : (
        <Callout tone="error" live title={failed.title}>
          {failed.body}
        </Callout>
      );
    default:
      return unreachable(reason);
  }
}
