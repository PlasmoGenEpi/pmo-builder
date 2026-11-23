/** Test helpers for the repository harvester and its command line. Not used by the app. */
import { buildDraft } from "@/domain/build";
import { EXAMPLE_MAPPINGS, mappedTable, rawTable, testContext } from "@/domain/build/testing";
import { createEmptyDraft, createPanelEntry } from "@/domain/draft";

/** Base URL for the `pmocommunity` Zenodo community records listing. */
export const LISTING_PREFIX = "https://zenodo.org/api/communities/pmocommunity/records";

/** First-page listing URL requested by the harvester for `pmocommunity`. */
export const LISTING = `${LISTING_PREFIX}?q=metadata.subjects.subject%3A%22Portable+Microhaplotype+Object%22&size=25&sort=newest`;

/** Listing URL for a given 1-based page number. */
export function listingPage(page: number): string {
  return page === 1 ? LISTING : `${LISTING_PREFIX}?page=${page}`;
}

/** Content download URL for one file in a Zenodo record. */
export function zenodoFileUrl(id: string, name: string): string {
  return `https://zenodo.org/api/records/${id}/files/${encodeURIComponent(name)}/content`;
}

/** Extracts the URL string from any `fetch` input. */
export function requestUrl(input: Parameters<typeof fetch>[0]): string {
  return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
}

/** A minimal valid PMO as UTF-8 JSON bytes, fast to parse across hundreds of records. */
export function minimalPmoBytes(): Uint8Array {
  const alleles = rawTable([{ SampleID: "s1", Locus: "t1", ASV: "ACGT", Reads: "10" }]);
  const panel = rawTable([{ amplicon: "t1", fwd_primer: "AAAA", rev_primer: "TTTT" }]);
  const empty = createEmptyDraft();
  const { merge } = buildDraft(
    {
      ...empty,
      microhaplotypes: {
        table: mappedTable("alleles", alleles, EXAMPLE_MAPPINGS.alleles),
        runName: { mode: "fixed", fixedName: "run1", column: null },
        representativeColumns: [],
      },
      panel: {
        panels: [
          {
            ...createPanelEntry("Panel1"),
            table: mappedTable("panel", panel, EXAMPLE_MAPPINGS.panel),
          },
        ],
      },
    },
    testContext({ alleles, panel }),
    { creationDate: "2026-01-01" },
  );
  if (merge.outcome.kind !== "built") throw new Error("minimal PMO did not build");
  return new TextEncoder().encode(JSON.stringify(merge.outcome.pmo));
}

/** Fields for building a synthetic Zenodo listing record in tests. */
export interface ZenodoRecordOptions {
  readonly files: readonly string[];
  readonly title?: string | null;
  readonly checksums?: Readonly<Record<string, string | null>>;
  readonly sizes?: Readonly<Record<string, number>>;
  readonly updated?: string;
  readonly revisionId?: number;
  readonly creators?: readonly string[];
  readonly doi?: string | null;
  readonly published?: string;
  readonly version?: string;
  readonly licence?: { readonly id: string; readonly title: string } | null;
}

/** Builds a synthetic Zenodo listing hit for tests. */
export function zenodoRecord(id: string, options: ZenodoRecordOptions): unknown {
  const title = options.title === undefined ? `Dataset ${id}` : options.title;
  const creators = options.creators ?? ["Okello, Grace", "PlasmoGenEpi"];
  const doi = options.doi === undefined ? `10.5281/zenodo.${id}` : options.doi;
  const licence =
    options.licence === undefined
      ? { id: "cc-by-4.0", title: "Creative Commons Attribution 4.0 International" }
      : options.licence;
  return {
    id,
    ...(options.updated === undefined ? {} : { updated: options.updated }),
    ...(options.revisionId === undefined ? {} : { revision_id: options.revisionId }),
    pids: doi === null ? {} : { doi: { identifier: doi } },
    links: { self_html: `https://zenodo.org/records/${id}` },
    metadata: {
      ...(title === null ? {} : { title }),
      publication_date: options.published ?? "2026-11-14",
      ...(options.version === undefined ? {} : { version: options.version }),
      creators: creators.map((name) => ({ person_or_org: { type: "personal", name } })),
      rights: licence === null ? [] : [{ id: licence.id, title: { en: licence.title } }],
    },
    files: {
      entries: Object.fromEntries(
        options.files.map((key) => {
          const checksum =
            options.checksums !== undefined && key in options.checksums
              ? options.checksums[key]
              : `md5:${id}-${key}`;
          const size = options.sizes?.[key] ?? 1234;
          return [key, { key, size, ...(checksum === null ? {} : { checksum }) }];
        }),
      ),
    },
  };
}
