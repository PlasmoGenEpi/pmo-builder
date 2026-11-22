# PMO Builder

PMO Builder turns a malaria genomics lab's spreadsheets into a Portable
Microhaplotype Object (PMO) file, in the browser. You import your allele
table, panel and optional sample and study tables, check how their columns
match PMO fields, and download a validated PMO JSON file. It replaces the
Streamlit app in `pmotools-app`. All PMO logic comes from
pmotools-ts, the TypeScript port of pmotools-python.

## The sections

The top bar has three sections, and the home page offers the same three:

- **Build** (`#/build/…`): make a PMO from your tables, step by step. The
  step list is in the sidebar, which appears only here.
- **My PMO file** (`#/pmo`): open a PMO file once, then look over it,
  download its tables, make a subset, or publish it, each on its own tab.
- **Published** (`#/published`): the PMOs published in the Zenodo community.
  Shown when the build sets a community.

Addresses from before the sections (`#/panel`, `#/publish`, `#/pmo-tools`
and so on) redirect to their new places.

## The steps

The steps of Build can be done in any order. Each one rebuilds its part of the PMO as
you go and shows whether it is ready. Only the first two are needed.

1. **Microhaplotypes**: the allele table, and the analysis run that made it.
2. **Panel**: the targets and primers of each panel, with an optional
   reference genome. A panel can be saved in the browser and reused.
3. **Specimens** and **Library samples**: the sample tables.
4. **Project**, **Sequencing** and **Bioinformatics**: typed in or from a
   table.
5. **Read counts by stage**: optional read counts from the pipeline.
6. **Review and download**: what is missing, what to check, and the PMO
   file, gzipped or as plain JSON.

The draft, including the imported files, is saved in the browser and comes
back on the next visit. "Try with example data" on the home page loads the
MAD4HATTER example.

## Publishing to Zenodo

When a PMO is valid, the review step can show a "Publish to Zenodo" panel for
one Zenodo community. It lists the personal details the PMO holds
(coordinates, exact dates, age and so on) and suggests a title, description
and keywords written from the PMO.

| Build variable               | Effect                                                                  |
| ---------------------------- | ----------------------------------------------------------------------- |
| `VITE_ZENODO_COMMUNITY`      | The community's identifier. Unset hides the panel                       |
| `VITE_ZENODO_COMMUNITY_NAME` | What to call the community on screen. Default: the identifier           |
| `VITE_ZENODO_CLIENT_ID`      | The Client ID of an application registered with Zenodo. Enables deposit |

Without a Client ID the panel guides the user through uploading by hand, and
the app sends nothing. With one, a deposit button signs the user in to Zenodo
in a new window, then creates a draft there with the file, the details, the
authors (filled in from the PMO's project and editable), links to the
BioProjects the data comes from, and a review request to the community. The
user submits the draft on Zenodo. A deposit can instead be a new version of a
record the user published: it replaces the file, keeps the record's details
and place in the community, gets its own DOI under the record's overall DOI,
and needs no review. The build then allows
`https://zenodo.org` in the Content Security Policy.

To register the application, sign in to Zenodo and open Applications, then
Developer Applications. Set the client type to Public and the redirect URI to
`zenodo-callback.html` beside the app, such as
`https://v2.pmotools.app/zenodo-callback.html`.

The Publish tab of My PMO file (`#/pmo/publish`) does the same for a PMO file
the user already has, built here earlier or with pmotools, or for a subset
of it. The file is read and checked in the browser, and only a file in PMO
version 1.1.0 that matches the format and whose tables link up can be
deposited. The user's draft is not touched.

The panel does not offer to publish the app's own example data. The example
tables use made-up sample names that start with `example_sample_`, and a PMO
holding any such sample cannot be published
(`src/domain/build/exampleData.ts`).

The deployed app uses the
[`pmocommunity`](https://zenodo.org/communities/pmocommunity/) community
("PMO Community"), with `VITE_ZENODO_COMMUNITY_NAME` set to `PMO`. The app
adds the word "community" itself. The keyword "Portable Microhaplotype
Object" marks a record as a PMO file, and the list of published PMOs is built
from it.

Zenodo lets only its own staff change a community's identifier. To move the
app to another community, create the new one, add the records to it, then
change the two repository variables and run the Deploy workflow.

## Published PMOs

The app lists the PMOs published in the Zenodo community under "Published
PMOs", with search and filters by country, panel and collection year, and a
page for each with its numbers, its download from Zenodo and a citation.

Zenodo is the store of record. The list is a file, `repository/index.json`,
that `pnpm harvest` rebuilds from Zenodo before each build:

- it lists every accepted record in the community that carries the keyword
  "Portable Microhaplotype Object";
- when a previous catalogue is available (from `--fallback`, or from `--out`
  when `--fallback` is omitted), any record whose PMO file fingerprint matches
  the last run keeps its entry and specimen rows with its title, authors and
  other listing details refreshed, without downloading the file again;
- it downloads the `.json` or `.json.gz` file of each new or changed record
  and keeps the record if the file matches the PMO format and its tables link
  up;
- a record removed from the community is dropped from both `index.json` and
  `specimens.json`;
- a record that fails is left out, tried again on the next run, and named on
  the workflow run's page along with how many records were carried over,
  downloaded and left out.

If the previous catalogue cannot be read or is in an older format version, the
harvester runs a full harvest. Pass `--full` to force a full rebuild even when
a previous catalogue exists:

```bash
pnpm harvest --community pmocommunity --full
```

The Deploy workflow harvests on every push and every night. If Zenodo cannot
be read, it keeps the list already on the site. GitHub pauses a nightly
schedule after 60 days without activity in a public repository, so each
nightly run enables the workflow again through the API to keep it going. If
the list's "Read from Zenodo on" date falls behind, enable the Deploy
workflow on the Actions page or run it by hand. To remove a PMO from the
list, remove its record from the community on Zenodo. `specimens.json`, one
row per specimen, is written beside the index for a later search across
datasets; no page reads it yet.

Run `pnpm harvest --community pmocommunity` to try the list locally. Running
it again carries unchanged records over from `public/repository/`. The output
folder, `public/repository/`, is not committed.

## My PMO file

My PMO file (`#/pmo`) opens a version 1.1.0 PMO file the user already has,
built here or downloaded from the published PMOs, and keeps it open while
the user moves between its tabs and the rest of the app. "Open it in My PMO
file" on the Review step opens the PMO the draft built, and "Open in My PMO
file" on a published dataset's page downloads that PMO from Zenodo and opens
it (`#/pmo/published/<record id>`). A published file is not offered for
depositing again, but a subset of it can be. The tabs:

- **Overview**: whether the file is valid, anything worth a look, and what it
  holds.
- **Summary**: headline numbers; a grid of reads for every sample and target;
  a sample table (targets with data, reads, and the most alleles at one
  target, a simple estimate of complexity of infection); a target table
  (samples with data, alleles, expected heterozygosity) with each target's
  allele frequencies. Each allele is labelled by its pseudoCIGAR when the
  PMO has one (shown as written: the format does not define its grammar),
  else by its structured variants, else by its differences from the
  target's most common allele, found by alignment so that an indel reads as
  one difference (`del 104–111`). One read threshold applies to every figure. The counts
  come from pmotools-ts (`countLibrarySamplesPerTarget`,
  `extractAlleleCountsFreqFromPmo`), checked against pmotools-python. A
  published dataset's page links straight to its summary
  (`#/pmo/published/<record id>/summary`).
  When the file has them, the Summary also shows: controls (from
  `specimen_type`), with a warning for a negative control with reads or a
  positive one without data; each plate's wells (from
  `library_prep_plate_info`); parasite density against targets with data;
  reads at each pipeline stage (from `read_counts_by_stage`); and the reads
  grid grouped by panel reaction. Each of these fields is optional in PMO, so
  each view appears only when there is data for it and says how much of the
  file it covers.
- **Compare**: specimens grouped by country, administrative area, collection
  year or month, or project (only fields the file has), side by side: samples
  with data, the share with more than one clone, heterozygosity per target,
  each target's microhaplotype frequencies per group, and a collection
  timeline. Specimens without a value form a "Not recorded" group.

- **Tables**: any of its tables as CSV or TSV: the allele table (one row per
  microhaplotype in each library sample, with reads), specimens, library
  samples, targets, panels, and the optional sections it has;
- **Subset**: a smaller PMO with only some specimens (ticked by name, or chosen by
  metadata values such as the country), some targets, or the
  microhaplotypes with at least a number of reads. The subset is checked
  against the PMO format and downloaded as `.json.gz` or `.json`, and its
  tables can be downloaded too, or the subset published.
- **Publish to Zenodo**: see above.

The work is done by `pmotools-ts` (`filterPmoBy…`, `extract…`,
`export…Table`), ported from pmotools-python and checked against it. The
file is read in the browser's worker and nothing is sent anywhere.

## Working offline

Once the app has been opened online, a service worker (`sw.js`, written by
`vite/serviceWorker.ts` at build time) keeps a copy of its files in the
browser, about 3 MB, so it opens and builds PMOs without a connection.
Opening the app tries the network first, so a new deploy arrives as soon as
the user is online. The list of published PMOs shows the last copy fetched.
Depositing on Zenodo needs a connection. The dev server does not register
the worker.

## Large files

Files are read in the browser, so the limit is the memory of a browser tab.
Delimited text files of up to about 100 MB work comfortably. The app refuses
a text file above 300 MB once unpacked, and an Excel workbook above 50 MB
(`IMPORT_LIMITS` in `src/domain/import/errors.ts`). To measure a change:

```bash
node scripts/generate-large-tables.mjs /tmp/big --rows 300000
node scripts/bench-large-files.mjs /tmp/big
```

The benchmark runs the engine in Node and reports the time and peak memory
of the import, build, merge, validation and export.

## Privacy

Your data never leaves your browser. PMO Builder is a set of static files with
no backend: files are read, matched, built and validated on your device, and
the PMO file is saved straight to your computer. A Content Security Policy
tells the browser to refuse connections to any other site. The app can send
anonymous usage counts, off unless the build names a receiver, and they are
typed so they cannot hold file names, column names or cell values. See
[docs/privacy.md](docs/privacy.md) for users and
[docs/analytics.md](docs/analytics.md) for maintainers.

## Quick start

You need Node 22.12 or later and pnpm (the version in `package.json`;
`corepack enable` installs it).

```bash
pnpm install
pnpm dev
```

Then open the address it prints.

## Commands

| Command           | What it does                                                     |
| ----------------- | ---------------------------------------------------------------- |
| `pnpm dev`        | Dev server with hot reload                                       |
| `pnpm build`      | Production build into `dist/`                                    |
| `pnpm preview`    | Serves `dist/`                                                   |
| `pnpm typecheck`  | TypeScript, no output                                            |
| `pnpm lint`       | oxlint, type-aware                                               |
| `pnpm format`     | oxfmt, writes files (`pnpm format:check` only checks)            |
| `pnpm test`       | Unit tests with Vitest                                           |
| `pnpm e2e`        | Builds, then runs the Playwright and axe tests against the build |
| `pnpm check`      | Format check, lint, typecheck, unit tests and build              |
| `pnpm harvest`    | Rebuilds the list of published PMOs from the Zenodo community    |
| `pnpm lib:update` | Rebuilds pmotools-ts from `../pmotools-ts` and vendors it        |

A pre-commit hook formats and lints staged files. Typecheck and tests run in
CI.

## The pmotools-ts dependency

pmotools-ts is not on npm yet. The app depends on a tarball in `vendor/`
(`"pmotools-ts": "file:vendor/pmotools-ts-0.0.0.tgz"`). To pick up changes,
check out pmotools-ts next to this repository and run:

```bash
pnpm lib:update            # or: pnpm lib:update /path/to/pmotools-ts
```

This builds the library, packs it into `vendor/` and reinstalls it. Commit the
new tarball and `pnpm-lock.yaml` together. Once pmotools-ts is published, the
dependency becomes an ordinary npm version and `vendor/` goes away.

## Deploying

The `Deploy` workflow builds the app and publishes `dist/` to GitHub Pages on
every push to `main`. In the repository settings, under Pages, set the source
to GitHub Actions. The build uses relative paths, so it works from any
subpath.

Usage counts stay off unless the repository variable `VITE_ANALYTICS_URL` is
set. Read [docs/analytics.md](docs/analytics.md) before setting it. The
"Publish to Zenodo" panel stays hidden unless the repository variable
`VITE_ZENODO_COMMUNITY` is set, and offers a deposit only when
`VITE_ZENODO_CLIENT_ID` is set too. Translation review links
(`#/translate/<language>/<key>`) work only when `VITE_TRANSLATION_REVIEW_URL`
holds the receiver Worker's address; see
[docs/translation.md](docs/translation.md).

Any other static host works too: run `pnpm build` and upload `dist/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

GPL-3.0-only, the same as pmotools-ts. See [LICENSE](LICENSE).
