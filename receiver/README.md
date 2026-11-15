# Usage count receiver

A Cloudflare Worker that receives PMO Builder's anonymous usage records and
keeps daily counts in a D1 database. What the records hold, and why this
design, is in [docs/analytics.md](../docs/analytics.md).

It is a separate small project: its dependencies are not the app's, and the
app's build does not touch it.

## What it does

- Accepts a `POST` with one record as JSON. Anything else gets `405`.
- Rejects a record that does not match
  [the schema](../docs/analytics-payload.schema.json), or is larger than
  8 KB, with `400`. So a record with a file name, a sample name or any free
  text in it is never stored.
- Never reads the IP address or any header.
- Adds one to a counter per fact, keyed by day. It keeps no record, so the
  facts of one visit cannot be joined back together.

## Deploying

You need a Cloudflare API token with the account permissions Workers Scripts
(Edit), D1 (Edit) and Account Settings (Read).

```bash
cd receiver
pnpm install --ignore-workspace
export CLOUDFLARE_API_TOKEN=...   # and CLOUDFLARE_ACCOUNT_ID if the token sees several accounts
pnpm exec wrangler deploy
```

Deploy again whenever `docs/analytics-payload.schema.json` changes, or the
receiver will turn the new records away.

For a new account, create the database first and put its id in
`wrangler.jsonc`:

```bash
pnpm exec wrangler d1 create pmo-builder-usage
pnpm exec wrangler d1 execute pmo-builder-usage --remote --command \
  "CREATE TABLE counts (day TEXT, metric TEXT, value TEXT, n INTEGER NOT NULL, PRIMARY KEY (day, metric, value))"
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
