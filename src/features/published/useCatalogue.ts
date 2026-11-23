import { useEffect, useState } from "react";

import { loadCatalogue, type CatalogueLoad } from "./catalogue";

/** The catalogue, or `loading` while it is fetched. */
export type CatalogueState = CatalogueLoad | { readonly kind: "loading" };

/** Loads the catalogue. Pages take one as a prop so tests can give their own. */
export type CatalogueLoader = () => Promise<CatalogueLoad>;

let shared: Promise<CatalogueLoad> | null = null;
let resolvedShared: CatalogueLoad | null = null;

/** Clears the shared catalogue cache. Intended for tests. */
export function resetSharedCatalogueForTests(): void {
  shared = null;
  resolvedShared = null;
}

/** Fetches the catalogue once for the whole visit; the list and each dataset page share it. */
export const loadSharedCatalogue: CatalogueLoader = () => {
  if (shared === null) {
    const pending = loadCatalogue().then((load) => {
      if (shared !== pending) return load;
      // A failed load is tried again on the next page that asks.
      if (load.kind === "failed") {
        shared = null;
        resolvedShared = null;
      } else {
        resolvedShared = load;
      }
      return load;
    });
    shared = pending;
  }
  return shared;
};

/** The catalogue as a page sees it. */
export function useCatalogue(load: CatalogueLoader = loadSharedCatalogue): CatalogueState {
  const cached = load === loadSharedCatalogue ? resolvedShared : null;
  const [state, setState] = useState<CatalogueState>(() => cached ?? { kind: "loading" });
  useEffect(() => {
    if (cached !== null) return undefined;
    let current = true;
    const read = async (): Promise<void> => {
      const result = await load();
      if (current) setState(result);
    };
    void read();
    return () => {
      current = false;
    };
  }, [load, cached]);
  return cached ?? state;
}
