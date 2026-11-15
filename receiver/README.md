# Usage count receiver

A Cloudflare Worker that receives PMO Builder's anonymous usage records and
keeps daily counts in a D1 database. It also keeps translation reviewers'
suggestions, under `/review/`: see [Translation review](#translation-review). What the records hold, and why this
design, is in [docs/analytics.md](../docs/analytics.md).

It is a separate small project: its dependencies are not the app's, and the
app's build does not touch it.

## What it does

- Accepts a `POST` with one record as JSON. Anything else gets `405`.
- Refuses with `400` a body over 8 KB, or anything that is not a visit or
  session record.
- Never reads the IP address or any header.
- Cuts the record into facts, such as `steps = panel`, and keeps only the
  facts on [its allowed list](src/allowed-facts.json). The list is generated
  from the app's own record format, so a file name, a sample name or any free
  text is never stored. A fact not on the list is dropped on its own and
  counted as `receiver.dropped`; the rest of the record still counts.
- Adds to a counter per fact, keyed by day. It keeps no record, so the facts
  of one visit cannot be joined back together.

## Deploying

The Deploy workflow deploys the receiver on every push to `main`, before the
site, from the same commit. It needs the repository secrets
`CLOUDFLARE_API_TOKEN` (account permissions Workers Scripts: Edit, D1: Edit,
Account Settings: Read) and `CLOUDFLARE_ACCOUNT_ID`. Without them the step
is skipped.

To deploy by hand:

```bash
cd receiver
pnpm install
export CLOUDFLARE_API_TOKEN=...   # and CLOUDFLARE_ACCOUNT_ID if the token sees several accounts
pnpm exec wrangler deploy
```

The tables are made by the files in `migrations/`, which the workflow applies
before each deploy. By hand:

```bash
pnpm exec wrangler d1 migrations apply pmo-builder-usage --remote
```

For a new account, create the database first and put its id in
`wrangler.jsonc`:

```bash
pnpm exec wrangler d1 create pmo-builder-usage
```

Keep `observability` off in `wrangler.jsonc` and do not add Logpush: both
would record the IP address of every request.

## Switching the app on

Set the repository variable `VITE_ANALYTICS_URL` to the Worker's address and
run the Deploy workflow. To switch it off, delete the variable and deploy
again.

## Reading the counts

```bash
pnpm counts
```

or any SQL through `pnpm exec wrangler d1 execute pmo-builder-usage --remote --command "..."`.
The table is `counts (day, metric, value, n)`.

## Translation review

`src/review.ts` answers `POST /review/session` and `POST /review/suggest` for
the app's translation review page (`#/translate/<language>/<key>`). Unlike
the usage counts, it keeps what reviewers type, with the name they give, so
the maintainers know who suggested what. It still reads no IP address and no
header but `Origin`.

- Only pages listed in `REVIEW_ORIGINS` (`wrangler.jsonc`) may call it.
- Each call needs a review link's key. Links are made, listed and revoked
  with `pnpm translations` in the app's folder; only a hash of each key is
  stored, in `review_links`.
- Suggestions are kept in `review_suggestions`, at most 20,000 per link.
- The app shows the review links only when it is built with
  `VITE_TRANSLATION_REVIEW_URL` set to this Worker's address.

See [docs/translation.md](../docs/translation.md) for the whole process.
