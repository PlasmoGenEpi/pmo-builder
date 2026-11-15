# Privacy

PMO Builder runs entirely in your browser. Your files, tables, sample names,
sequences and metadata stay on this device. They are never uploaded, and the
app has no server to upload them to. The one exception is a deposit on Zenodo
that you ask for yourself, described below.

## What stays on this device

- The files you open and everything in them.
- Everything you type and every column you match.
- The PMO file you build. It is made in the browser and saved straight to
  your computer.

## What this browser keeps

- Your draft, including the files you opened, so you can pick up where you
  left off.
- Panels you save to your library.
- Your theme and your choice about usage counts.
- A saved draft that could not be opened. It is kept aside until you save a
  new draft on a later visit or choose Start over, then deleted.

If your browser does not let the app store data, as in some private windows,
the draft lasts only until you close or reload the page.

To remove your draft, its files and any draft that could not be opened,
choose Start over, in the step list or the menu. Saved panels are kept: delete each one on the
Panel step. To remove everything at once, clear this site's data in your
browser's settings.

If you open the app in two tabs, only one of them saves your draft. The other
says so and offers to take over, so the two never overwrite each other.

## Publishing to Zenodo

A copy of PMO Builder can show a "Publish to Zenodo" panel on the review
step. A record published on Zenodo is public and cannot be withdrawn, so the
panel first lists the details about the people sampled that your PMO holds.

The panel works in one of two ways, depending on how the copy was set up.

- **Upload by hand.** The app sends nothing. The panel links to Zenodo's
  upload page, which opens in a new tab without telling Zenodo where you came
  from. Your PMO reaches Zenodo only when you upload the file there yourself.
- **Deposit.** When you choose the deposit button, you sign in to Zenodo in
  its own window. Your PMO file and the record's title, description and
  keywords then go from your browser straight to Zenodo, which makes a draft.
  Nothing is published until you submit that draft on Zenodo. Nothing goes to
  Zenodo before you choose the button, and nothing passes through a server
  of this project. The sign-in allows making and changing drafts, not
  publishing them, and the app forgets it when you close or reload the page.

The "Publish a PMO file" page works the same way for a file you already
have: it is read and checked in your browser, and goes to Zenodo only if you
choose to deposit it.

## Published PMOs

The list of published PMOs is a file on this site, so browsing and searching
it contacts nothing else. A download, or a link to a record, opens Zenodo.

## Usage counts

This copy of PMO Builder may send anonymous usage counts to help its
maintainers see how much the app is used and where people get stuck. Your
settings show whether this copy sends them.

If it does, it sends at most two small records per visit. They say things
like "the panel step was opened", "a table of 100 to 999 rows was imported",
"a PMO was downloaded", "a deposit on Zenodo was started and its draft was
made" or "this error code came up". They never contain your file names,
column names, sample names, cell values or error messages, or which
published dataset you looked at. They
contain no identifier, so two visits cannot be linked. You can see the exact
records in the app before or after they are sent.

Like any request on the internet, sending a record reveals your IP address
and the time to the service that receives it. The receiver this project
provides discards them and keeps only daily totals.

Nothing is sent if your browser sends Global Privacy Control or Do Not Track,
or if you switch usage counts off in the app. Switching off is remembered in
this browser.

## Checking for yourself

The app tells your browser, through a Content Security Policy, that it may
connect only to its own site and, if usage counts are on, to the one service
that receives them. Your browser blocks any other connection. You can see
this policy in the page source and watch every request in your browser's
developer tools.

The source code is public. `docs/analytics.md` describes the usage counts in
detail.
