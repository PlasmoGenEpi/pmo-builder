# PMO Builder

PMO Builder turns a lab's tables into a Portable Microhaplotype Object (PMO)
file, and lets people work with PMO files they already have. Everything runs
in the browser.

## Building a PMO

**Draft**:
Everything the user has entered or imported to build a PMO: the tables, how
their columns match PMO fields, and hand-entered records. Saved in the browser
as the user goes.
_Avoid_: project, form, submission

**Built PMO**:
The PMO the app makes from the current draft. Always derived, never edited.
_Avoid_: output, result, export

## Working with a PMO file

**Working PMO**:
The one PMO file open in My PMO file, together with the subset made from it,
if any. Opening another file replaces it. Viewing a published PMO leaves it
alone; a published PMO becomes the working PMO only when the user asks to
work with it.
_Avoid_: workspace, open file, loaded PMO

**Origin**:
Where a working PMO came from: a file the user chose, the built PMO, or a
published PMO downloaded from Zenodo.
_Avoid_: source (that word is taken by the original or subset choice)

**Original**:
The working PMO as it was opened, before any subset.

**Subset**:
A smaller PMO made from the original by keeping chosen specimens and targets.
There is at most one at a time; making a new one replaces it.
_Avoid_: filter, extract, slice

**Published PMO**:
A PMO file deposited in the Zenodo community and listed in the app's
catalogue.
_Avoid_: dataset (except for the page that shows one), record

**Published view**:
The read-only view of a published PMO at its own address, with Overview,
Summary, Compare and Tables. It holds the file apart from the working PMO for
the visit and drops it on leaving; it never replaces the working PMO unless
the user asks to work with the file.
_Avoid_: preview, published workspace

**Deposit**:
Sending a PMO file to Zenodo as a new record or a new version, at the user's
request.
_Avoid_: upload, publish (on its own, "publish" names the whole step)
