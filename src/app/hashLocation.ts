/**
 * Hash-based location hook for wouter that keeps query strings inside the hash
 * (`#/published?q=kenya`) instead of moving them onto `window.location.search`,
 * so route matching stays clean and top-level query parameters such as `?lang=fr`
 * are never overwritten.
 */
import { useSyncExternalStore } from "react";

/** How the latest navigation in this visit occurred. */
export type NavigationKind = "push" | "replace" | "pop";

/** Path and query extracted from a URL hash. */
export interface HashParts {
  /** Path starting with `/`, such as `/published`. */
  readonly path: string;
  /** Query string without a leading `?`, or `""` when absent. */
  readonly search: string;
}

/** Options accepted by {@link navigate}. */
export interface HashNavigateOptions {
  readonly state?: unknown;
  readonly replace?: boolean;
}

const HASH_PREFIX = /^#?\/?/;

let lastNavKind: NavigationKind = "push";
let listeners: readonly (() => void)[] = [];

function notify(): void {
  for (const listener of listeners) listener();
}

function onHashChange(): void {
  notify();
}

function onPopState(): void {
  lastNavKind = "pop";
  notify();
}

function subscribeToHashUpdates(callback: () => void): () => void {
  listeners = [...listeners, callback];
  if (listeners.length === 1) {
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onPopState);
  }
  return () => {
    listeners = listeners.filter((listener) => listener !== callback);
    if (listeners.length === 0) {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onPopState);
    }
  };
}

/** Splits a URL hash (`#/published?q=kenya`) into its route path and query string. */
export function splitHash(hash: string): HashParts {
  const stripped = hash.replace(HASH_PREFIX, "");
  const queryStart = stripped.indexOf("?");
  if (queryStart === -1) return { path: `/${stripped}`, search: "" };
  return {
    path: `/${stripped.slice(0, queryStart)}`,
    search: stripped.slice(queryStart + 1),
  };
}

function currentHashPath(): string {
  return splitHash(window.location.hash).path;
}

function currentHashSearch(): string {
  return splitHash(window.location.hash).search;
}

/** Whether the most recent navigation was a push, a replace, or browser history traversal (`pop`). */
export function lastNavigationKind(): NavigationKind {
  return lastNavKind;
}

/** Navigates to a hash route while leaving `window.location.search` untouched. */
export function navigate(to: string, options: HashNavigateOptions = {}): void {
  const { state = null, replace = false } = options;
  lastNavKind = replace ? "replace" : "push";
  const oldURL = window.location.href;
  const url = new URL(oldURL);
  url.hash = `#/${to.replace(HASH_PREFIX, "")}`;
  const newURL = url.href;

  window.history[replace ? "replaceState" : "pushState"](state, "", newURL);

  const event =
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange");
  window.dispatchEvent(event);
}

/** Returns the query string inside the current hash route, without a leading `?`. */
export function useHashSearch(options: { readonly ssrSearch?: string } = {}): string {
  return useSyncExternalStore(
    subscribeToHashUpdates,
    currentHashSearch,
    () => options.ssrSearch ?? "",
  );
}

/** Wouter location hook that reads the pathname from `window.location.hash` and pairs with {@link useHashSearch}. */
export function useHashLocation(
  options: { readonly ssrPath?: string } = {},
): [string, typeof navigate] {
  return [
    useSyncExternalStore(subscribeToHashUpdates, currentHashPath, () => options.ssrPath ?? "/"),
    navigate,
  ];
}

useHashLocation.searchHook = useHashSearch;
useHashLocation.hrefs = (href: string): string => `#${href}`;
