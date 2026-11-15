/**
 * Telling the app's own example data apart from a user's data, so the
 * example is not published to a repository by accident.
 *
 * The example tables in `public/examples` use made-up sample names that all
 * start with {@link EXAMPLE_SAMPLE_PREFIX}. No real dataset has them, so a
 * real PMO is never mistaken for the example.
 */

/** What every library sample name in the example tables starts with. */
export const EXAMPLE_SAMPLE_PREFIX = "example_sample_";

/**
 * True when any library sample is one of the example's, as when the example
 * was loaded, its files were uploaded again, or example tables were mixed
 * with a user's own.
 */
export function isExampleData(librarySampleNames: readonly string[]): boolean {
  return librarySampleNames.some((name) => name.startsWith(EXAMPLE_SAMPLE_PREFIX));
}
