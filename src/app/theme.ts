import { useSyncExternalStore } from "react";

/** What the user chose. `system` follows the operating system setting. */
export type ThemePreference = "light" | "dark" | "system";
/** The theme actually shown. */
export type ResolvedTheme = "light" | "dark";

/** localStorage key. `public/theme-init.js`, loaded in index.html, reads it before first paint. */
export const THEME_STORAGE_KEY = "pmo-builder.theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function isPreference(value: unknown): value is ThemePreference {
  return value === "light" || value === "dark" || value === "system";
}

function readPreference(): ThemePreference {
  try {
    const stored: unknown = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isPreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
    ? "dark"
    : "light";
}

function resolve(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

interface ThemeSnapshot {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

let snapshot: ThemeSnapshot | null = null;
const listeners = new Set<() => void>();

function current(): ThemeSnapshot {
  if (snapshot === null) {
    const preference = readPreference();
    snapshot = { preference, resolved: resolve(preference) };
  }
  return snapshot;
}

function apply(next: ThemeSnapshot) {
  snapshot = next;
  document.documentElement.dataset.theme = next.resolved;
  for (const listener of listeners) listener();
}

function onSystemChange() {
  const { preference } = current();
  if (preference === "system") apply({ preference, resolved: systemTheme() });
}

/** Another tab changed the theme. */
function onStorage(event: StorageEvent) {
  if (event.key !== THEME_STORAGE_KEY) return;
  const preference = readPreference();
  apply({ preference, resolved: resolve(preference) });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
  media?.addEventListener("change", onSystemChange);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", onSystemChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Saves the user's choice and applies it to the page at once. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be blocked. The choice still applies for this visit.
  }
  apply({ preference, resolved: resolve(preference) });
}

// Mark <html> with the theme as soon as the app loads. `public/theme-init.js`
// has already applied a saved light or dark choice before first paint; with
// no saved choice, the CSS follows the system setting through `color-scheme`.
if (typeof document !== "undefined") document.documentElement.dataset.theme = current().resolved;

/** For tests: forget the cached choice so the next read comes from storage. */
export function resetThemeForTests(): void {
  snapshot = null;
}

/** What {@link useTheme} returns. */
export interface ThemeState extends ThemeSnapshot {
  setPreference: (preference: ThemePreference) => void;
  /** Switches between light and dark, and stops following the system. */
  toggle: () => void;
}

/**
 * The current theme and functions to change it. The theme follows
 * `prefers-color-scheme` until the user picks one; the choice is kept in
 * localStorage.
 */
export function useTheme(): ThemeState {
  const state = useSyncExternalStore(subscribe, current, current);
  return {
    ...state,
    setPreference: setThemePreference,
    toggle: () => setThemePreference(state.resolved === "dark" ? "light" : "dark"),
  };
}
