# Usage counts

This note is for the maintainers. It says what PMO Builder can report about
its own use, how the design stops lab data from being reported, how to switch
it on, and which receiver to use.

The short version: the app can send two small records per visit. Every value
in them comes from a fixed list or is a coarse bucket. Nothing is sent unless
the build names a receiver. The browser's Content Security Policy blocks
every other destination. A user can see the exact records and switch them off.

## What is collected

Two records, with nothing that links them to each other, to a person or to a
browser.

**Visit.** Sent once when the app loads.

| Field  | Values                           |
| ------ | -------------------------------- |
| `v`    | `1`, the payload version         |
| `kind` | `visit`                          |
| `app`  | app version, `major.minor.patch` |

**Session summary.** Sent at most once per page load, when the page is hidden
or closed, and only if the user did something: opened a step, imported a
table, changed a column match, built, validated or downloaded. A restored
draft or a status change alone does not count.

| Field                          | Values                                                    |
| ------------------------------ | --------------------------------------------------------- |
| `v`, `kind`, `app`             | `1`, `session`, app version                               |
| `steps`                        | steps opened, each once, in navigation order              |
| `tables.<table>.import`        | last import of that table this session, or `null`         |
| `tables.<table>.import.route`  | `upload`, `example` or `saved-panel`                      |
| `...import.format`, `.gzip`    | `csv`, `tsv`, `txt`, `xlsx` or `other`; `true` or `false` |
| `...import.rows`               | `0`, `1-9`, `10-99`, ... `100000+`                        |
| `...import.columns`            | `0`, `1-4`, `5-9`, `10-19`, `20-49`, `50-99`, `100+`      |
| `tables.<table>.mappingEdited` | whether the user changed an automatic column match        |
| `sections.<section>`           | last status: `empty`, `incomplete`, `ready` or `error`    |
| `build.built`, `build.failed`  | count bucket: `0`, `1`, `2-4`, `5-9`, `10-99`, `100+`     |
| `build.validation`             | `not-run`, `valid` or `invalid`                           |
| `build.schemaErrors`           | count bucket for the last validation                      |
| `build.downloads.plain/gzip`   | count bucket                                              |
| `build.downloadSize`           | `0-10kb` up to `100mb+`, or `null`                        |
| `issues[]`                     | `{ code, severity, count }`, at most 32, sorted by code   |
| `draftRestored`                | whether a saved draft was restored on load                |
| `duration`                     | `0-1m`, `1-5m`, `5-15m`, `15-60m`, `60m+`                 |

`<table>` and `<section>` are fixed names such as `panelTargets` and
`microhaplotypes`. An issue `code` is a pmotools-ts code such as
`panel/duplicate-target-names`, an app code from the list in
`src/analytics/codes.ts`, `<module>/other` for an unlisted code from a known
module, or `other`.

The full contract is the JSON Schema in
[`analytics-payload.schema.json`](analytics-payload.schema.json). It lists
every allowed value. A receiver should reject anything that does not match.

Neither record has a timestamp. The receiver adds the date.

## What is not collected

- No file names, column names, cell values, sample names, sequences or
  metadata, in any form.
- No error messages. Only stable codes, and only codes on a fixed list.
- No identifiers: no cookies, no generated ids, nothing stored to recognise a
  returning browser. The only thing the module stores is the user's off
  switch, in `localStorage`.
- No fingerprinting inputs: no screen size, time zone, language, user agent,
  referrer or page URL.
- No exact counts or sizes. Only buckets.
- No order of events beyond "these steps were opened".

## How the guarantees are enforced

**Types.** In `src/analytics/payload.ts`, every property is a boolean, a
member of a fixed list, or a bucket label. No property is typed `string` or
`number`. The issue code is a closed list too: an unknown code becomes
`<module>/other` or `other`, so even a code cannot carry free text.

**Runtime checks.** The recording functions accept anything at runtime and
drop or relabel what does not fit, so a caller that bypasses the types still
cannot leak. Records are built field by field; caller objects are never
copied or spread. Every function swallows its own errors.

**Leak test.** `src/analytics/leak.test.ts` pushes a file name, a column name,
a cell value and look-alike codes through every exported function and hook,
in every argument position and as extra properties, then checks that none of
it appears in what was sent, the transparency log or the preview.

**Schema.** `docs/analytics-payload.schema.json` is generated from the same
lists as the types. A test fails if the file and the code disagree, and checks
real records against it. The reference receiver rejects anything else.

**Content Security Policy.** The build writes a policy into `index.html`
(`vite/csp.ts`). `connect-src` allows the app's own origin and, when
configured, the receiver's origin, and nothing else. So even a bug or a
compromised dependency cannot send data elsewhere: the browser refuses.
`e2e/privacy.spec.ts` checks the policy is served, that the browser blocks a
request to another origin, and that walking through the app makes no
cross-origin request. A `Referrer-Policy` of `no-referrer` stops the page URL
going with any request.

The policy as built with no receiver:

```text
default-src 'self'; connect-src 'self'; script-src 'self'; worker-src 'self' blob:;
img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; object-src 'none';
base-uri 'self'; form-action 'none'
```

`style-src` allows inline styles because Radix dialogs and menus insert a
`<style>` element at runtime to lock page scroll. Inline styles cannot make
requests that the other directives forbid.

A `<meta>` policy cannot set `frame-ancestors`, so the app can be framed by
another site. GitHub Pages cannot set headers. If the app moves to a host that
can, send the same policy as a header and add `frame-ancestors 'none'`.

**Opt-outs.** Nothing is sent when:

1. the build did not set `VITE_ANALYTICS_URL` (the default),
2. the browser sends Global Privacy Control,
3. the browser sends Do Not Track, or
4. the user switched it off. The choice is kept in `localStorage` under
   `pmo-builder:usage-counts`.

`getAnalyticsStatus()` says which applies.

**Transparency.** The module keeps the exact JSON of every record it sent, or
would have sent, during this page load, and can show the session record as it
stands now. The hooks `useAnalyticsStatus`, `useAnalyticsPreference` and
`useTransparencyLog` give the interface what it needs to show this to the
user, with the switch beside it. Records are logged even when sending is off,
so a user can see what would go before deciding.

**Transport.** `navigator.sendBeacon` with a `text/plain` body, so there is no
preflight request. If the beacon is refused, `fetch` with `keepalive`,
`credentials: "omit"` and `referrerPolicy: "no-referrer"`. Failures are
silent. Note that `sendBeacon` sends any cookies the browser holds for the
receiver's domain, so the receiver must not set cookies. The reference
receiver sets none.

## What any request reveals

Any request from a browser reveals some things to whoever receives it, whatever
the body says:

- the IP address and the time,
- the `User-Agent` and `Accept-Language` headers, which every browser sends,
- the `Origin` header, which names the site the app is served from.

The reference receiver never reads these and stores only daily counts. But the
service it runs on (Cloudflare, in the recommendation below) sees them at the
network level and handles them under its own privacy policy. The same is true
of the host that serves the app itself: GitHub sees the IP address of every
visitor to a GitHub Pages site, with or without usage counts.

So the honest form of "no data transits to us" is: no lab data ever leaves
the browser, and the usage records contain nothing about the user or their
work. The request that carries a record does reveal an IP address and a time
to the receiving service, which discards them before anything is stored.
`docs/privacy.md` says this in plain words for users.

## Switching it on

1. Deploy a receiver (see below) and note its https URL.
2. In the GitHub repository, open Settings, then Secrets and variables, then
   Actions, then Variables, and add `VITE_ANALYTICS_URL` with that URL.
3. Run the Deploy workflow, or push to `main`.
4. Open the deployed app, view the page source and check that `connect-src`
   lists the receiver's origin. Check that the receiver's count goes up.

To switch it off again, delete the variable and redeploy. For a local build,
copy `.env.example` to `.env.local` and set the variable there.

The build fails if `VITE_ANALYTICS_URL` is not an https URL (plain http is
allowed for `localhost`, to test a receiver).

## For feature authors

Pages do not record anything. The recording is wired in two places:

- `src/main.tsx` calls `initAnalytics()` once at start-up, and the router in
  `src/app/App.tsx` calls `recordStepOpened` on every navigation.
- `src/state/instrumentation.ts` watches the app store's state and events and
  calls every other `record*` function: imports and failed imports, mapping
  edits, section statuses, builds, validation, downloads, error and warning
  codes, a restored draft, a failed save and a stopped worker. The default
  store is instrumented when it is created (`src/state/hooks.tsx`).

So a new page gets its counts by going through the store's actions. If a new
kind of user action should be counted, emit an event from the store and
record it in `instrumentation.ts`, with a test in `instrumentation.test.ts`.
Pass only fixed names, codes and counts: never a file name, column name or
cell value. `fileFormatFromName(file.name)` turns a file name into a format
label.

`codes.test.ts` reads the app's sources and fails when a notice code is not
on `APP_CODES` in `src/analytics/codes.ts`, or when a listed code is no longer
raised. After changing the list, regenerate the schema:

```bash
UPDATE_ANALYTICS_SCHEMA=1 pnpm vitest run src/analytics && pnpm format
```

## Choosing a receiver

The app does not depend on any receiver. It posts the JSON record to one URL.
These are the realistic choices for an academic consortium with static
hosting and no backend.

### Host statistics only, no in-app counts

Leave `VITE_ANALYTICS_URL` unset.

- **Answers.** On GitHub Pages: nothing. GitHub gives no visitor statistics
  for Pages sites. The repository's Traffic graph counts visits to the
  repository on github.com, not to the app. Hosts such as Cloudflare Pages or
  Netlify can count page loads from their server logs, some for a fee.
- **Cannot answer.** Which steps people use, which imports fail, whether
  anyone downloads a PMO.
- **Sees.** Whatever the host already sees: IP addresses, user agents, pages.
- **Cost and upkeep.** None.
- **Who else gets the data.** Only the host.

### A privacy-focused hosted counter (GoatCounter, Plausible)

- **Answers.** Page views, and custom events with a few properties. Our record
  would have to be flattened into their event format by an adapter in the
  app, or sent as many small events.
- **Cannot answer.** Neither can reject a record that does not match our
  schema. They accept any event name and property value they are sent, so the
  receiving side adds no protection.
- **Sees.** The IP address and user agent. Both say they do not store the IP
  address. Both derive the country from it and the browser and operating
  system from the user agent, and keep those. Both make a salted hash of the
  IP address and user agent to count unique visitors, with the salt rotated
  within a day.
- **Cost.** GoatCounter is free for non-commercial use at small volume.
  Plausible costs about 9 euros a month at the smallest plan. Both can be
  self-hosted, which brings back the need for a server.
- **Upkeep.** Low: an account and a site setting. An adapter in the app.
- **Who else gets the data.** The service, and its hosting provider.

### A small serverless function (Cloudflare Worker with D1)

- **Answers.** Everything in the session record, as daily counts: steps
  opened, import routes and sizes, error codes, builds and downloads.
- **Cannot answer.** Combinations within one session (for example "people who
  uploaded a gzip file and then hit a merge error"), because the reference
  receiver stores each fact as a separate counter. Keeping whole records
  would allow that, at the cost of storing more.
- **Sees.** The Worker gets the IP address and headers with each request. The
  reference receiver does not read them. Cloudflare sees them at the network
  level. Workers Logs and Logpush would record them, so keep both off.
- **Cost.** Free at this scale. The free plan allows 100,000 Worker requests a
  day and 100,000 D1 row writes a day; a session record writes about 25 to 60
  counters, so the free plan covers more than 1,500 sessions a day. Check
  current limits before relying on them. Workers Analytics Engine is an
  alternative store with similar limits, but it keeps data for only three
  months.
- **Upkeep.** A Cloudflare account owned by the project, one Worker and one
  database, deployed with `wrangler`. Redeploy when the schema changes.
- **Who else gets the data.** Cloudflare, as the processor.

### Recommendation

Use the Cloudflare Worker with D1 and the reference receiver below. It is the
only option that checks every record against our schema and rejects the rest,
stores nothing but daily counts, costs nothing at our scale, and gives
nobody but the maintainers and Cloudflare (as processor) any data. If no one
can own a Cloudflare account for the project, do not switch usage counts on:
host statistics alone are better than a hosted counter that needs an adapter
and accepts any data.

### Reference receiver

[`receiver/worker.js`](receiver/worker.js), 55 lines. It validates each
record with `@cfworker/json-schema` against
[`analytics-payload.schema.json`](analytics-payload.schema.json), never reads
the IP address or headers, and adds one to a `(day, metric, value)` counter
for each fact in the record. It keeps no record, so stored facts cannot be
joined back into sessions.

To deploy it, in a separate folder (not in this repository's build):

```bash
npm create cloudflare@latest pmo-builder-usage -- --type hello-world --lang js
cd pmo-builder-usage
npm install @cfworker/json-schema
cp ../pmo-builder/docs/receiver/worker.js src/index.js
mkdir -p docs && cp ../pmo-builder/docs/analytics-payload.schema.json docs/
# fix the schema import path in src/index.js to ../docs/analytics-payload.schema.json
npx wrangler d1 create pmo-builder-usage   # add the binding it prints, named DB
npx wrangler d1 execute pmo-builder-usage --remote --command \
  "CREATE TABLE counts (day TEXT, metric TEXT, value TEXT, n INTEGER NOT NULL, PRIMARY KEY (day, metric, value))"
npx wrangler deploy
```

In `wrangler.jsonc`, set `"observability": { "enabled": false }` and do not
add Logpush.

To read the counts:

```bash
npx wrangler d1 execute pmo-builder-usage --remote --command \
  "SELECT metric, value, SUM(n) AS n FROM counts WHERE day >= '2026-11-01' GROUP BY metric, value ORDER BY metric, n DESC"
```

Useful metrics: `kind` (visits and sessions), `steps`, `tables.<table>.import.route`,
`sections.<section>`, `build.validation`, `issues`.
