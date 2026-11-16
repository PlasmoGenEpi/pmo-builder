# Working in pmo-builder

PMO Builder is a static, client-side web app that turns a lab's tables into a
Portable Microhaplotype Object (PMO) file. It replaces the Streamlit and
Pyodide app in `pmotools-app`. All PMO logic comes from the `pmotools-ts`
library. The user's data never leaves the browser.

## Stack

React 19, TypeScript 7 (strict), Vite 8, Tailwind CSS 4, Radix primitives
(`radix-ui`), `lucide-react` icons, `wouter` with hash routing, `zustand` for
state, `idb-keyval` for IndexedDB, `papaparse` and `read-excel-file` for
imports. Vitest and Testing Library for unit tests, Playwright for end-to-end
tests. oxlint (type-aware) and oxfmt for linting and formatting.

## Layout

| Path                         | What it holds                                                                          | May import from                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/domain/types.ts`        | Contracts shared by every module                                                       | `pmotools-ts` types                                                                 |
| `src/domain/errors.ts`       | Error helpers every module may use, such as `describeError`                            | nothing                                                                             |
| `src/domain/import/`         | File to typed table: csv, tsv, txt, gz, xlsx                                           | `types`, `pmotools-ts`                                                              |
| `src/domain/fields/`         | Field specs and header aliases for each table                                          | `types`                                                                             |
| `src/domain/matching/`       | Column auto-matching and mapping checks                                                | `types`                                                                             |
| `src/domain/draft/`          | The draft model, form specs, persistence                                               | `domain/*`                                                                          |
| `src/domain/build/`          | Draft to PMO fragments, merge, validate, export                                        | `domain/*`, `pmotools-ts`                                                           |
| `src/domain/tools/`          | Working with a PMO the user has: choices, subsets, tables. Calls `pmotools-ts`         | `domain/*`, `pmotools-ts`                                                           |
| `src/domain/repository/`     | The catalogue of published PMOs and the harvester that builds it                       | `domain/*`, `pmotools-ts`. Node only, except `types.ts`                             |
| `src/worker/`                | The web worker that runs imports and builds, and its client                            | `domain/*`                                                                          |
| `src/state/`                 | The app store, the working PMO session, their hooks, and usage counts wired to them    | `domain`, `worker`, `analytics`                                                     |
| `src/i18n/`                  | The interface language: choosing it and loading its catalog                            | `locales`                                                                           |
| `src/locales/`               | The translation catalogs (`.po`). Written by `pnpm i18n:extract`                       |                                                                                     |
| `src/analytics/`             | Usage instrumentation                                                                  | nothing in `domain`                                                                 |
| `src/ui/`                    | Design system primitives. No domain knowledge                                          | `styles`                                                                            |
| `src/app/`                   | Shell: layout, top-bar sections, step sidebar, routes, home, `StepLink`                | `ui`, `domain`, `state`, `analytics`                                                |
| `src/features/<step>/`       | One folder per step page                                                               | `ui`, `app`, `domain`, `state`, `analytics`, the three below                        |
| `src/features/table-import/` | Import a table and match its columns, for every step                                   | `ui`, `domain`, `state`                                                             |
| `src/features/records/`      | Hand-entered records: forms, lists, suggestions                                        | `ui`, `domain`                                                                      |
| `src/features/published/`    | The list of published PMOs and each dataset's page                                     | `ui`, `app`, `domain/repository/types`, `features/review`                           |
| `src/features/pmo-file/`     | My PMO file: one file opened, then its overview, tables, subset and publishing         | `ui`, `app`, `domain/tools/types`, `state`, `features/review`, `features/published` |
| `src/features/translate/`    | The translation review page, opened from a private link. In English, not translated    | `ui`, `app`, `i18n`                                                                 |
| `src/features/shared/`       | Parts several steps use: result card, name checks, run name                            | `ui`, `app`, `domain`, `state`, `table-import`                                      |
| `src/test/`                  | Test setup and shared test helpers                                                     | anything                                                                            |
| `e2e/`                       | Playwright tests against the built app                                                 |                                                                                     |
| `e2e/fixtures/`              | The privacy fixture: fails a test that contacts another origin                         |                                                                                     |
| `scripts/`                   | Large-table generator and benchmark, `pmotools-ts` update, harvest                     |                                                                                     |
| `receiver/`                  | The Cloudflare Worker: usage counts, and translation review. Its own project           |                                                                                     |
| `vite/`                      | Build plugins (security policy, chunk rules, offline service worker), with their tests |                                                                                     |
| `public/examples/`           | Example tables served with the app                                                     |                                                                                     |
| `reference/`                 | Material from the old app, for reading only. Not bundled                               |                                                                                     |
| `vendor/`                    | The `pmotools-ts` tarball. Do not edit                                                 |                                                                                     |

`src/domain` and `src/worker` contain no React and never touch `document` or
`window`. Import across folders with the `@/` alias (`@/domain/types`).

## Commands

```bash
pnpm dev            # dev server
pnpm typecheck      # tsc --noEmit
pnpm lint           # oxlint --type-aware
pnpm format         # oxfmt, writes files
pnpm test           # vitest run, all projects
pnpm vitest run src/domain/import   # one folder
pnpm build          # production build into dist/
pnpm e2e            # Playwright, builds first
pnpm check          # format check, lint, typecheck, test, build
```

Before you finish, `pnpm format`, `pnpm lint`, `pnpm typecheck` and the tests
for your files must pass. Other people are working in other folders at the same
time, so a failure outside your folders is not yours to fix. Report it.

## Using pmotools-ts

Import from `"pmotools-ts"`. Read its API in
`node_modules/pmotools-ts/dist/index.d.ts` and the `.d.ts` files beside it.
The source, README and tests are in
[pmotools-ts](https://github.com/PlasmoGenEpi/pmotools-ts), checked out next
to this repository as `../pmotools-ts` (read only). Do not copy its logic into this repo and do not work around its
bugs silently: if it does something wrong, say so in your report.

Its tables are `readonly Row[]` (plain objects). Missing cells are `null`,
`undefined` or `NaN`. Builders throw `PmoError` with a stable `code`; softer
problems arrive through `onWarning` or `collectWarnings`.

## Conventions

**TypeScript.** No `any`. No non-null `!`. Avoid `as`: narrow with type guards,
and treat anything parsed or loaded from storage as `unknown` until checked.
Model states as discriminated unions rather than optional flags. Take more than
two parameters as one options object. Named exports only. JSDoc on every
export.

**React.** Function components and hooks. State that several steps share lives
in the draft store; local state stays local. Derive, do not duplicate: never
store what can be computed from the draft. No `useEffect` for derived values.
Heavy work (parsing, building, validating) runs in the worker.

**Styling.** Tailwind utilities with the tokens defined in `src/styles`. No
hard-coded colours, spacing or font sizes outside the tokens. Use the
primitives in `src/ui` instead of raw `<button>`, `<input>` or `<select>`. If a
primitive is missing, say so in your report rather than building a one-off.

**Accessibility.** WCAG 2.2 AA. Every control has a visible label or an
`aria-label`, works from the keyboard and shows a focus ring. Status is never
shown by colour alone. Respect `prefers-reduced-motion`.

**Words on screen and in docs.** Plain, short, sentence case. Say what
happened and what to do next. No exclamation marks, no em dashes, no jargon the
lab user would not use, and no internal names (say "sample table", not
"library_sample_info", unless you are naming a PMO field). Error messages name
the column or row at fault.

**Translatable text.** Every word a user can see goes through Lingui, so the
interface can be translated. That includes labels, hints, headings, button
text, `aria-label`s, placeholders, toasts, error messages and notice messages.
The translation review page (`src/features/translate/`) is the exception: its
readers review the English, so it is written in English only.

- Plain text: `` t`Saved ${fileName}` `` from `@lingui/core/macro`. Give an
  interpolated value a clear variable name first, so translators see
  `{fileName}`, not `{0}`.
- Text with elements inside, such as a link in a sentence:
  `<Trans>Read the <Link href={url}>PMO documentation</Link>.</Trans>` from
  `@lingui/react/macro`.
- Counts: `plural(count, { one: "# specimen", other: "# specimens" })` from
  `@lingui/core/macro`. Never choose a word with `count === 1`, since other
  languages have other plural rules.
- Whole sentences only. Never build a sentence from translated pieces
  (``t`in` + " " + country``); put the whole sentence in one message with
  placeholders, so a translator can reorder it.
- When a short message is ambiguous, add a note for translators:
  `t({ message: "Run", comment: "Noun: a sequencing run" })`.
- Not translated: PMO field names and values, column names, codes, file names,
  units (`KB`), the PMO format's own words, and anything sent to Zenodo.
- Numbers and dates: `formatCount`, `formatBytes`, or `Intl.*(intlLocale())`
  from `@/i18n/languages`. Never a fixed `"en-US"`.
- `t` may be used anywhere, including in constants worked out when a module
  loads: the page and the worker both load the language before importing the
  app's modules.
- After changing text, run `pnpm i18n:extract` and commit `src/locales/`. CI
  fails when the catalogs and the code disagree (`pnpm i18n:check`).
- In the same change, draft the new or changed messages in every catalog
  (`fr.po`, `pt.po`), following the conventions and glossary in
  `docs/translation.md`. Reviewers check drafts through their review links,
  where anything new or changed shows as "To check". A language in `OFFERED`
  must have every message translated, or CI fails.
- Preview a language with `?lang=fr`; `?lang=pseudo` shows every wrapped string
  lengthened and accented, so plain English is text not yet wrapped.

**Privacy.** The app makes no network request that carries user data, with
one exception: a deposit on Zenodo that the user asks for, sent only by
`src/features/review/zenodoDeposit.ts`. Opening a published PMO downloads
its public file from zenodo.org (`src/features/pmo-file/OpenPublished.tsx`)
and sends nothing of the user's. The translation review page sends a
reviewer's name and suggestions, never anything from a draft, through
`src/features/translate/reviewApi.ts` only. No third-party scripts, fonts or
images. Analytics events go through
`src/analytics` only, and their payloads are typed so they cannot hold file
names, column names or cell values.

**Dependencies.** Do not add, remove or upgrade packages. If you think one is
needed, finish without it and say so in your report.

**Tests.** Test behaviour through public functions and rendered components.
Use the files in `public/examples/` for realistic input. A test file sits
beside the code it tests (`foo.ts`, `foo.test.ts`).

## Product shape

The steps, in navigation order:

| Group             | Step                                                | Needed |
| ----------------- | --------------------------------------------------- | ------ |
| Required          | Microhaplotypes: the allele table                   | yes    |
| Required          | Panel: targets and primers, with an optional genome | yes    |
| Samples           | Specimens                                           | no     |
| Samples           | Library samples                                     | no     |
| Study and methods | Project                                             | no     |
| Study and methods | Sequencing                                          | no     |
| Study and methods | Bioinformatics: methods and runs                    | no     |
| Extras            | Read counts by stage                                | no     |
| Finish            | Review and download                                 |        |

Design principles:

1. **Never lose work.** The draft, including the imported files, is saved in
   the browser as the user goes and restored on the next visit.
2. **Derived, not submitted.** There is no "Transform" button. Each section
   rebuilds when its inputs change, and its status is always current.
3. **Any order.** Steps are not gated. The review step says what is missing.
4. **Match first, ask second.** Columns are matched to fields automatically.
   The user confirms doubtful matches rather than mapping every field by hand.
5. **Optional stays out of the way.** Required fields are shown first.
   Optional fields are collapsed and searchable.
6. **Errors help.** A message says what is wrong, where, and how to fix it.
7. **Privacy is visible.** The app says, where the user can see it, that data
   stays on this device.

`reference/pmotools-app-field-aliases.json` lists the old app's field names
and header aliases. What each page of the old app did is recorded in
`docs/pmotools-app-pages.md`.
