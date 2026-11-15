import { Trans } from "@lingui/react/macro";

import { useHasSavedDraft } from "@/app/draftHooks";
import { StartOverButton } from "@/app/StartOver";
import { Link } from "@/ui";

/** What a PMO file is for, where to read more, and where the draft is kept. */
export function WhatNext() {
  const hasDraft = useHasSavedDraft();
  return (
    <section aria-labelledby="review-next-heading" className="flex flex-col gap-2">
      <h2 id="review-next-heading" className="text-lg font-semibold tracking-tight text-text">
        <Trans>What next</Trans>
      </h2>
      <p className="max-w-prose text-base text-text-muted">
        <Trans>
          A PMO file holds your samples, panel and allele calls in one shared format, so you can
          share them, archive them, or open them in other analysis tools. Read about the format and
          the tools that use it in the{" "}
          <Link href="https://plasmogenepi.github.io/PMO_Docs/" external>
            PMO documentation
          </Link>
          .
        </Trans>
      </p>
      <p className="max-w-prose text-base text-text-muted">
        <Trans>
          Your draft stays in this browser, so you can come back and change it. When you are done
          with it, start over to clear it for the next PMO.
        </Trans>
      </p>
      {hasDraft ? (
        <div>
          <StartOverButton>
            <Trans>Start over for a new PMO</Trans>
          </StartOverButton>
        </div>
      ) : null}
    </section>
  );
}
