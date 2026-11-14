import { Bell, Download, Plus, Settings, Trash2, Upload } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  Checkbox,
  CodeBlock,
  Combobox,
  ConfirmDialog,
  DataTable,
  Dialog,
  DialogClose,
  Disclosure,
  EmptyState,
  Field,
  FileDropzone,
  IconButton,
  KeyValueList,
  Link,
  Menu,
  NumberField,
  Popover,
  ProgressBar,
  RadioGroup,
  SectionHeading,
  SegmentedControl,
  Select,
  Skeleton,
  Spinner,
  Stat,
  StatusBadge,
  Switch,
  Tabs,
  TextArea,
  TextField,
  Tooltip,
  useToast,
  type ChosenFile,
  type ComboboxOption,
} from "@/ui";

import { PageContainer } from "../PageContainer";
import { SAMPLE_COLUMNS, SAMPLE_JSON, SAMPLE_ROWS } from "./sampleData";

const SWATCHES: readonly { name: string; className: string }[] = [
  { name: "canvas", className: "bg-canvas" },
  { name: "surface", className: "bg-surface" },
  { name: "surface-subtle", className: "bg-surface-subtle" },
  { name: "surface-muted", className: "bg-surface-muted" },
  { name: "border", className: "bg-border" },
  { name: "border-strong", className: "bg-border-strong" },
  { name: "text", className: "bg-text" },
  { name: "text-muted", className: "bg-text-muted" },
  { name: "accent", className: "bg-accent" },
  { name: "accent-subtle", className: "bg-accent-subtle" },
  { name: "success", className: "bg-success" },
  { name: "success-subtle", className: "bg-success-subtle" },
  { name: "warning", className: "bg-warning" },
  { name: "warning-subtle", className: "bg-warning-subtle" },
  { name: "danger", className: "bg-danger" },
  { name: "danger-subtle", className: "bg-danger-subtle" },
  { name: "info", className: "bg-info" },
  { name: "info-subtle", className: "bg-info-subtle" },
];

const COLUMN_OPTIONS: ComboboxOption[] = [
  ...SAMPLE_COLUMNS.map((column) => ({
    value: column,
    label: column,
    description: String(SAMPLE_ROWS[0]?.[column] ?? ""),
  })),
  ...Array.from({ length: 300 }, (_, index) => ({
    value: `extra_column_${index + 1}`,
    label: `extra_column_${index + 1}`,
    description: `value ${index + 1}`,
  })),
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-border pt-8">
      <h2 className="text-lg font-semibold tracking-tight text-text">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-text-subtle">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

function Primitives() {
  const { toast } = useToast();
  const [text, setText] = useState("MAD4HatTeR");
  const [count, setCount] = useState<number | null>(1);
  const [platform, setPlatform] = useState<string | undefined>("illumina");
  const [column, setColumn] = useState<string | null>("SampleID");
  const [unmapped, setUnmapped] = useState<string | null>(null);
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(false);
  const [genome, setGenome] = useState<"none" | "manual" | "table">("manual");
  const [view, setView] = useState<"fields" | "table" | "json">("fields");
  const [file, setFile] = useState<ChosenFile | null>({
    name: "mad4hatter_allele_data_example.csv",
    size: 1_284_311,
    rows: 12_431,
    columns: 6,
  });

  return (
    <div className="flex flex-col gap-10">
      <Section title="Colour tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SWATCHES.map((swatch) => (
            <div key={swatch.name} className="flex flex-col gap-1.5">
              <span className={`h-10 rounded-md border border-border ${swatch.className}`} />
              <span className="font-mono text-xs text-text-muted">{swatch.name}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-semibold tracking-tight">Page hero, 3xl</p>
          <p className="text-2xl font-semibold tracking-tight">Page title, 2xl</p>
          <p className="text-lg font-semibold tracking-tight">Section heading, lg</p>
          <p className="text-md text-text-muted">Lead paragraph, md, in muted text.</p>
          <p className="text-base">
            Body text, base. Map the columns of your allele table to PMO fields.
          </p>
          <p className="text-sm text-text-muted">Small text, sm, for hints and captions.</p>
          <p className="font-mono text-sm">ATGCGTACGTTAGCCTAGGCTAACGT sample_001.tsv</p>
        </div>
      </Section>

      <Section title="Buttons and links">
        <Row label="Variants">
          <Button variant="primary">Primary</Button>
          <Button>Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={Trash2}>
            Danger
          </Button>
        </Row>
        <Row label="Sizes, icon, loading and disabled">
          <Button size="sm" icon={Plus}>
            Small
          </Button>
          <Button icon={Upload}>Medium</Button>
          <Button size="lg" variant="primary" icon={Download}>
            Large
          </Button>
          <Button variant="primary" loading>
            Building
          </Button>
          <Button disabled>Disabled</Button>
        </Row>
        <Row label="Icon buttons and links">
          <IconButton label="Settings" icon={Settings} />
          <IconButton label="Notifications" icon={Bell} variant="secondary" />
          <Link href="#/styleguide">Inline link</Link>
          <Link href="https://plasmogenepi.org" external>
            External link
          </Link>
          <ButtonLink href="#/styleguide" variant="secondary" size="sm">
            Button link
          </ButtonLink>
        </Row>
      </Section>

      <Section title="Form controls">
        <div className="grid gap-6 md:grid-cols-2">
          <TextField
            label="Panel name"
            hint="As it appears in your lab notes."
            required
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <TextField
            label="Forward primer"
            mono
            error="Primer sequences can only contain A, C, G and T. Row 4 has an X."
            defaultValue="ACGTXAGCT"
          />
          <NumberField
            label="Taxon ID"
            hint="From the NCBI taxonomy."
            integer
            min={1}
            optional
            value={count}
            onValueChange={setCount}
          />
          <TextField label="Disabled" disabled defaultValue="Read only" />
          <Field label="Sequencing platform" hint="A short list, so a select.">
            <Select
              value={platform}
              onValueChange={setPlatform}
              options={[
                { value: "illumina", label: "Illumina" },
                { value: "nanopore", label: "Oxford Nanopore" },
                { value: "pacbio", label: "PacBio" },
              ]}
            />
          </Field>
          <Field
            label="Sample name column"
            hint="Search 306 columns. Each shows an example value."
            required
          >
            <Combobox mono options={COLUMN_OPTIONS} value={column} onChange={setColumn} />
          </Field>
          <Field label="Unmapped field" hint="Nothing chosen yet.">
            <Combobox
              mono
              options={COLUMN_OPTIONS}
              value={unmapped}
              onChange={setUnmapped}
              noneDescription="Leave this field out"
            />
          </Field>
          <TextArea label="Project description" optional placeholder="What the project studies" />
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex flex-col gap-4">
            <Checkbox
              label="Carry unmapped columns into the PMO"
              description="They are kept as extra fields."
              checked={checked}
              onCheckedChange={setChecked}
            />
            <Checkbox
              label="Some columns selected"
              checked="indeterminate"
              onCheckedChange={() => {}}
            />
            <Checkbox label="Disabled" checked={false} disabled onCheckedChange={() => {}} />
            <Switch
              label="Show optional fields"
              description="Fields a PMO can be built without."
              checked={switched}
              onCheckedChange={setSwitched}
            />
          </div>
          <div className="flex flex-col gap-4">
            <RadioGroup
              label="Reference genome"
              value={genome}
              onValueChange={setGenome}
              options={[
                { value: "none", label: "No genome" },
                {
                  value: "manual",
                  label: "Type it in",
                  description: "Name, version and taxon ID.",
                },
                { value: "table", label: "From a table" },
              ]}
            />
            <SegmentedControl
              label="View"
              value={view}
              onValueChange={setView}
              segments={[
                { value: "fields", label: "Fields" },
                { value: "table", label: "Table" },
                { value: "json", label: "JSON" },
              ]}
            />
          </div>
        </div>
      </Section>

      <Section title="Content">
        <Card>
          <SectionHeading
            title="Allele table"
            description="12,431 rows from mad4hatter_allele_data_example.csv."
            actions={<Button size="sm">Replace</Button>}
          />
          <div className="mt-6 grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat value={12431} label="Rows" />
            <Stat value={48} label="Samples" />
            <Stat value={165} label="Targets" hint="3 not in the panel" />
            <Stat value="0.4 s" label="Build time" />
          </div>
        </Card>
        <Row label="Badges">
          <Badge>Optional</Badge>
          <Badge tone="accent">Required</Badge>
          <Badge tone="success">Matched</Badge>
          <Badge tone="warning">Check this</Badge>
          <Badge tone="danger">Missing</Badge>
          <Badge tone="info">12 fields</Badge>
        </Row>
        <Row label="Status badges">
          <StatusBadge status="empty" />
          <StatusBadge status="incomplete" />
          <StatusBadge status="ready" />
          <StatusBadge status="error" />
        </Row>
        <KeyValueList
          items={[
            { label: "File", value: "mad4hatter_panel_info_example.csv", mono: true },
            { label: "Delimiter", value: "Comma" },
            { label: "Rows", value: "165" },
            { label: "Sheet", value: "Not a workbook" },
          ]}
        />
      </Section>

      <Section title="Feedback">
        <div className="flex flex-col gap-3">
          <Callout tone="info" title="Columns were matched for you">
            Check the matches marked Check this before you continue.
          </Callout>
          <Callout tone="success" title="Panel is ready">
            165 targets and their primers will be included.
          </Callout>
          <Callout
            tone="warning"
            title="3 targets are not in the panel"
            action={<Button size="sm">Show targets</Button>}
          >
            Rows with these targets are left out of the PMO.
          </Callout>
          <Callout tone="error" title="The reads column has text in it">
            Row 18 of the allele table has &quot;n/a&quot; in reads. Enter a whole number or leave
            it blank.
          </Callout>
        </div>
        <EmptyState
          title="No allele table yet"
          description="Add a CSV, TSV or Excel file to see its columns here."
          action={
            <Button variant="primary" icon={Upload}>
              Choose a file
            </Button>
          }
        />
        <div className="grid gap-6 md:grid-cols-2">
          <ProgressBar label="Reading allele table" value={64} />
          <ProgressBar label="Building the PMO" value={null} />
        </div>
        <Row label="Spinner and skeleton">
          <Spinner />
          <Spinner size="lg" />
          <div className="flex w-64 flex-col gap-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-full" />
          </div>
        </Row>
      </Section>

      <Section title="Overlays">
        <Row label="Click to open">
          <Dialog
            title="Genome details"
            description="Where the reference sequence comes from."
            trigger={<Button>Dialog</Button>}
            footer={
              <>
                <DialogClose>
                  <Button>Cancel</Button>
                </DialogClose>
                <DialogClose>
                  <Button variant="primary">Save</Button>
                </DialogClose>
              </>
            }
          >
            <TextField label="Genome name" defaultValue="Pf3D7" />
          </Dialog>
          <ConfirmDialog
            trigger={<Button variant="danger">Confirm dialog</Button>}
            title="Remove the panel table?"
            description="The table and its column choices are removed. You can add it again."
            confirmLabel="Remove table"
            tone="danger"
            onConfirm={() => {}}
          />
          <Popover trigger={<Button>Popover</Button>} label="About matching">
            <p className="font-medium">How matching works</p>
            <p className="mt-1 text-text-muted">
              Column names are compared with the PMO field names and common alternatives.
            </p>
          </Popover>
          <Tooltip content="Tooltips repeat a label">
            <Button>Tooltip</Button>
          </Tooltip>
          <Menu
            align="start"
            trigger={<Button>Menu</Button>}
            entries={[
              { kind: "item", label: "Rename", onSelect: () => {} },
              { kind: "separator" },
              { kind: "item", label: "Delete", danger: true, icon: Trash2, onSelect: () => {} },
            ]}
          />
          <Button
            onClick={() =>
              toast({
                title: "PMO file downloaded",
                description: "pmo_2026-11-14.json",
                tone: "success",
              })
            }
          >
            Toast
          </Button>
          <Button
            onClick={() =>
              toast({
                title: "The panel table could not be read",
                description: "Save it as CSV and try again.",
                tone: "error",
              })
            }
          >
            Error toast
          </Button>
        </Row>
      </Section>

      <Section title="Structure">
        <Tabs
          label="Panel views"
          tabs={[
            {
              value: "fields",
              label: "Fields",
              count: 3,
              content: <p className="text-text-muted">Required fields are listed first.</p>,
            },
            {
              value: "preview",
              label: "Preview",
              content: <p className="text-text-muted">A preview of the table.</p>,
            },
            {
              value: "warnings",
              label: "Warnings",
              count: 0,
              content: <p className="text-text-muted">No warnings.</p>,
            },
          ]}
        />
        <div className="flex flex-col gap-3">
          <Disclosure title="Optional fields" summary="12 fields, 4 matched" defaultOpen>
            <p className="text-text-muted">Optional fields stay collapsed until you need them.</p>
          </Disclosure>
          <Disclosure title="Additional columns" summary="2 columns">
            <p className="text-text-muted">Hidden content.</p>
          </Disclosure>
        </div>
      </Section>

      <Section title="Data table">
        <DataTable
          label="Preview of the allele table"
          columns={SAMPLE_COLUMNS}
          rows={SAMPLE_ROWS}
          totalRows={12431}
          highlightedColumns={{
            SampleID: "Library sample name",
            Locus: "Target name",
            ASV: "Sequence",
            Reads: "Reads",
          }}
          height="sm"
        />
      </Section>

      <Section title="File dropzone">
        <div className="grid gap-6 md:grid-cols-2">
          <FileDropzone
            label="Allele table"
            accept={[".csv", ".tsv", ".txt", ".gz", ".xlsx"]}
            file={null}
            onFileSelect={(chosen) => setFile({ name: chosen.name, size: chosen.size })}
            onRemove={() => setFile(null)}
          />
          <FileDropzone
            label="Panel table"
            accept={[".csv", ".tsv", ".xlsx"]}
            file={null}
            busy="Reading 1.2 MB"
            onFileSelect={() => {}}
            onRemove={() => {}}
          />
          <FileDropzone
            label="Specimen table"
            accept={[".csv", ".tsv", ".xlsx"]}
            file={null}
            error="specimens.pdf is not a file type this step can read. Choose a CSV, TSV or XLSX file."
            onFileSelect={() => {}}
            onRemove={() => {}}
          />
          <FileDropzone
            label="Allele table"
            accept={[".csv", ".tsv", ".txt", ".gz", ".xlsx"]}
            file={file}
            onFileSelect={(chosen) => setFile({ name: chosen.name, size: chosen.size })}
            onRemove={() => setFile(null)}
          />
        </div>
      </Section>

      <Section title="Code block">
        <CodeBlock label="PMO preview" code={SAMPLE_JSON} chunkSize={1200} />
      </Section>
    </div>
  );
}

/** Every primitive in its main states. Open at `#/styleguide`. */
export function StyleguidePage() {
  const [mode, setMode] = useState<"current" | "both">("current");
  return (
    <PageContainer width="full">
      <header className="flex flex-wrap items-end justify-between gap-4 pb-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight text-text">Style guide</h1>
          <p className="text-md text-text-muted">
            The primitives in <code className="text-sm">src/ui</code>, in their main states.
          </p>
        </div>
        <SegmentedControl
          label="Themes shown"
          value={mode}
          onValueChange={setMode}
          segments={[
            { value: "current", label: "Current theme" },
            { value: "both", label: "Light and dark" },
          ]}
        />
      </header>
      {mode === "current" ? (
        <div className="max-w-5xl">
          <Primitives />
        </div>
      ) : (
        <div className="grid gap-6 xl:grid-cols-2">
          {(["light", "dark"] as const).map((theme) => (
            <div
              key={theme}
              data-theme={theme}
              className="min-w-0 rounded-xl border border-border bg-surface p-6 text-text"
            >
              <p className="mb-6 text-sm font-medium text-text-muted">
                {theme === "light" ? "Light" : "Dark"} theme
              </p>
              <Primitives />
            </div>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
