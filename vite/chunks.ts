/**
 * How the build splits the app into chunks. See `vite.config.ts`.
 */

/**
 * The `index.ts` files under `src` that only re-export. The build treats them
 * as free of side effects, so an import through one goes straight to the
 * module that defines the name, and a primitive that only one step uses
 * loads with that step instead of with the shell. `chunks.test.ts` checks
 * that each still only re-exports.
 */
export const BARREL =
  /\/src\/(?:ui|state|worker|domain\/(?:draft|build)|features\/(?:records|shared|table-import))\/index\.ts$/;

/**
 * Libraries every page needs on first load, kept in their own chunk so that
 * a new release of the app does not invalidate them in the browser's cache.
 */
export const VENDOR =
  /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react|react-dom|scheduler|wouter|zustand|use-sync-external-store|regexparam|mitt)\//;
