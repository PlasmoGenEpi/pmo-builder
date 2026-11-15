# Usage count receiver

A Cloudflare Worker that receives PMO Builder's anonymous usage records and
keeps daily counts in a D1 database. What the records hold, and why this
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
