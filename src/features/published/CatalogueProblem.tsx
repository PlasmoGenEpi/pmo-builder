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
      <output className="flex flex-col gap-4" aria-busy="true" aria-label="Loading">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </output>
    );
  }
  return state.kind === "missing" ? (
    <Callout tone="info" title="This copy of PMO Builder has no list of published PMOs">
      The list is made when the app is set up with a Zenodo community.
    </Callout>
  ) : (
    <Callout tone="error" title="The list of published PMOs could not be loaded">
      Check your connection and reload the page.
    </Callout>
  );
}
