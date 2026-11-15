import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";

import { Callout, Skeleton } from "@/ui";

import type { CatalogueState } from "./useCatalogue";

/** What a page shows in place of the catalogue while it loads or when it cannot be read. */
export function CatalogueProblem({
  state,
}: {
  readonly state: Exclude<CatalogueState, { readonly kind: "ready" }>;
}) {
  if (state.kind === "loading") {
    return (
      <output className="flex flex-col gap-4" aria-busy="true" aria-label={t`Loading`}>
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </output>
    );
  }
  return state.kind === "missing" ? (
    <Callout tone="info" title={t`This copy of PMO Builder has no list of published PMOs`}>
      <Trans>The list is made when the app is set up with a Zenodo community.</Trans>
    </Callout>
  ) : (
    <Callout tone="error" title={t`The list of published PMOs could not be loaded`}>
      <Trans>Check your connection and reload the page.</Trans>
    </Callout>
  );
}
