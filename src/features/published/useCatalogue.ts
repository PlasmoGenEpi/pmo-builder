import { useEffect, useState } from "react";

import { loadCatalogue, type CatalogueLoad } from "./catalogue";

/** The catalogue, or `loading` while it is fetched. */
export type CatalogueState = CatalogueLoad | { readonly kind: "loading" };

/** Loads the catalogue. Pages take one as a prop so tests can give their own. */
export type CatalogueLoader = () => Promise<CatalogueLoad>;

let shared: Promise<CatalogueLoad> | null = null;

/** Fetches the catalogue once for the whole visit; the list and each dataset page share it. */
export const loadSharedCatalogue: CatalogueLoader = () => {
  shared ??= loadCatalogue().then((load) => {
    // A failed load is tried again on the next page that asks.
    if (load.kind === "failed") shared = null;
    return load;
  });
  return shared;
};

/** The catalogue as a page sees it. */
export function useCatalogue(load: CatalogueLoader = loadSharedCatalogue): CatalogueState {
  const [state, setState] = useState<CatalogueState>({ kind: "loading" });
  useEffect(() => {
    let current = true;
    const read = async (): Promise<void> => {
      const result = await load();
      if (current) setState(result);
    };
    void read();
    return () => {
      current = false;
    };
  }, [load]);
  return state;
}
