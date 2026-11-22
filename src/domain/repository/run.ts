/**
 * The harvester's command line. `scripts/harvest.mjs` loads this through
 * Vite, so it can use the app's own modules.
 *
 *   pnpm harvest [--community <id>] [--out <dir>] [--fallback <url>] [--full]
 */
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// English, for any message the app's own modules build while harvesting.
import "@/i18n";

import { harvest, HarvestError, type PreviousCatalogue } from "./harvest";
import { REPOSITORY_PATH, type HarvestResult } from "./types";

/** Zenodo turns away clients that do not name themselves. */
const USER_AGENT = "pmo-repository-harvester/1.0";

/** Optional dependencies for {@link run}. */
export interface RunOptions {
  /** Default: the global `fetch`. */
  readonly fetch?: typeof fetch;
}

function namedFetch(base: typeof fetch): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("User-Agent", USER_AGENT);
    return base(input, { ...init, headers });
  };
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

function baseUrl(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

async function write(directory: string, name: string, value: unknown): Promise<void> {
  await writeFile(path.join(directory, name), `${JSON.stringify(value)}\n`);
}

async function loadPreviousFromUrl(
  fallback: string,
  send: typeof fetch,
): Promise<PreviousCatalogue | undefined> {
  try {
    const base = baseUrl(fallback);
    const [indexResponse, specimensResponse] = await Promise.all([
      send(new URL("index.json", base)),
      send(new URL("specimens.json", base)),
    ]);
    if (!indexResponse.ok || !specimensResponse.ok) return undefined;
    const [index, specimens]: [unknown, unknown] = await Promise.all([
      indexResponse.json(),
      specimensResponse.json(),
    ]);
    return { index, specimens };
  } catch {
    return undefined;
  }
}

async function loadPreviousFromDisk(directory: string): Promise<PreviousCatalogue | undefined> {
  try {
    const [indexText, specimensText] = await Promise.all([
      readFile(path.join(directory, "index.json"), "utf8"),
      readFile(path.join(directory, "specimens.json"), "utf8"),
    ]);
    return { index: JSON.parse(indexText), specimens: JSON.parse(specimensText) };
  } catch {
    return undefined;
  }
}

/** A note for the curators on the workflow run's page, when run by GitHub Actions. */
async function report(result: HarvestResult): Promise<void> {
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary === undefined || summary === "") return;
  const lines = [
    `### Published PMOs: ${result.index.datasets.length} in the catalogue (${result.carriedOver} carried over, ${result.downloaded} downloaded), ${result.skipped.length} left out`,
    "",
    ...result.skipped.map(
      (record) => `- [${record.title}](https://zenodo.org/records/${record.id}): ${record.reason}`,
    ),
    "",
  ];
  await appendFile(summary, lines.join("\n"));
}

/**
 * Harvests the community and writes `index.json` and `specimens.json`.
 * Unchanged records are carried over from the last catalogue (`--fallback`, or
 * `--out` when `--fallback` is omitted) unless `--full` is passed. When Zenodo
 * cannot be read and `--fallback` names the address of the last published
 * catalogue, that one is kept. Returns the exit code.
 */
export async function run(args: readonly string[], options: RunOptions = {}): Promise<number> {
  const send = namedFetch(options.fetch ?? globalThis.fetch);
  const community = option(args, "community") ?? process.env["VITE_ZENODO_COMMUNITY"] ?? "";
  const out = option(args, "out") ?? path.join("public", REPOSITORY_PATH);
  const fallback = option(args, "fallback");
  const full = args.includes("--full");
  if (community.trim() === "") {
    console.warn(
      "No Zenodo community is set (VITE_ZENODO_COMMUNITY), so there is no catalogue to build.",
    );
    return 0;
  }
  await mkdir(out, { recursive: true });
  const previous = full
    ? undefined
    : fallback !== undefined
      ? await loadPreviousFromUrl(fallback, send)
      : await loadPreviousFromDisk(out);
  try {
    const result = await harvest({
      community: community.trim(),
      fetch: send,
      log: (message) => console.warn(message),
      previous,
    });
    await write(out, "index.json", result.index);
    await write(out, "specimens.json", result.specimens);
    await report(result);
    console.warn(
      `Catalogue written to ${out}: ${result.index.datasets.length} datasets (${result.carriedOver} carried over, ${result.downloaded} downloaded), ${result.specimens.length} specimens, ${result.skipped.length} records left out.`,
    );
    return 0;
  } catch (error) {
    if (!(error instanceof HarvestError)) throw error;
    console.error(error.message);
    if (fallback === undefined) return 1;
    // Keep the catalogue that is already published, so a deploy while Zenodo
    // is down does not empty the page.
    const base = baseUrl(fallback);
    for (const name of ["index.json", "specimens.json"]) {
      // oxlint-disable-next-line no-await-in-loop -- two small files
      const response = await send(new URL(name, base));
      if (!response.ok) {
        console.error(
          `The last catalogue could not be read from ${base}${name} (${response.status}).`,
        );
        return 1;
      }
      // oxlint-disable-next-line no-await-in-loop
      await writeFile(path.join(out, name), await response.text());
    }
    console.warn(`Kept the last published catalogue from ${base}.`);
    return 0;
  }
}
