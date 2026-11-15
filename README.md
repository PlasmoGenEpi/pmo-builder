# PMO Builder

PMO Builder turns a malaria genomics lab's spreadsheets into a Portable
Microhaplotype Object (PMO) file, in the browser. You import your allele
table, panel and optional sample and study tables, check how their columns
match PMO fields, and download a validated PMO JSON file. It replaces the
Streamlit app in `pmotools-app`. All PMO logic comes from
pmotools-ts, the TypeScript port of pmotools-python.

## The steps

The steps can be done in any order. Each one rebuilds its part of the PMO as
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
in a new window, then creates a draft there with the file, the details and a
review request to the community. The user submits the draft on Zenodo. The
build then allows `https://zenodo.org` in the Content Security Policy.

To register the application, sign in to Zenodo and open Applications, then
Developer Applications. Set the client type to Public and the redirect URI to
`zenodo-callback.html` beside the app, such as
`https://v2.pmotools.app/zenodo-callback.html`.

The deployed app uses the
[`plasmogenepi`](https://zenodo.org/communities/plasmogenepi/) community,
where the keyword "Portable Microhaplotype Object" places a record with the
other PMO files.

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
`VITE_ZENODO_CLIENT_ID` is set too.

Any other static host works too: run `pnpm build` and upload `dist/`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licence

GPL-3.0-only, the same as pmotools-ts. See [LICENSE](LICENSE).
