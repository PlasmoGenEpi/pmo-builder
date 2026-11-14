/**
 * The fields of the records a user can type in by hand or import as a table:
 * project, sequencing, bioinformatics method steps and runs, and a panel's
 * genome. Each field is defined once here. The column field sets in
 * `./study` and the form fields in `@/domain/draft` are both made from these
 * definitions, so a table row and a form record are read the same way.
 *
 * Keys, required flags and formats come from the PMO JSON Schema v1.1.0
 * (`node_modules/pmotools-ts/schemas/portable_microhaplotype_object_v1.1.0.schema.json`).
 * `forms.test.ts` in `@/domain/draft` checks the keys against the generated
 * PMO types and the formats against the schema.
 */
import type { FieldKind } from "../types";
import type { KeyedFieldSpec } from "./define";

/**
 * How a record field is entered and read.
 *
 * - `text`: one line.
 * - `multiline`: free text over several lines.
 * - `date`: `YYYY-MM` or `YYYY-MM-DD`.
 * - `url`: a web address.
 * - `list`: several values. In a form, one per line; in a table cell, separated by commas.
 * - `integerList`: like `list`, but every value is a whole number.
 */
export type FormFieldKind = "text" | "multiline" | "date" | "url" | "list" | "integerList";

/** A format the schema imposes on a field, with a sentence that says what is allowed. */
export interface FormatRule {
  readonly pattern: RegExp;
  /** Completes "It can only hold ...", or says what the value must look like. */
  readonly hint: string;
}

/** One field of a hand-entered record, as a form shows it. */
export interface FormFieldSpec<K extends string = string> {
  /** The PMO field name. */
  readonly key: K;
  /** Short name shown to the user, in sentence case. */
  readonly label: string;
  /** One plain sentence saying what belongs in the field. */
  readonly description: string;
  readonly required: boolean;
  readonly kind: FormFieldKind;
  /** The schema's format for the value (each item, for lists), or `null` for free text. */
  readonly format: FormatRule | null;
  /** Example value to show as a placeholder. */
  readonly example: string;
  /**
   * Usual values to offer while typing. Suggestions only: any value the
   * format accepts is still allowed. Each one must pass the format.
   */
  readonly suggestions?: readonly string[];
}

/** One record field, defined once: what a form needs, and what matching a table column needs. */
export interface RecordFieldDefinition<K extends string = string> extends FormFieldSpec<K> {
  /** Other header names that mean this field, most likely first. */
  readonly aliases: readonly string[];
  /** Optional heading that groups related optional fields in the mapping editor. */
  readonly group?: string;
}

/**
 * Usual values for the sequencing fields, from the INSDC and SRA
 * vocabularies. The PMO schema does not restrict these fields to a list, but
 * readers of a PMO will recognise these terms.
 */
export const SEQUENCING_VOCABULARIES = {
  seq_platform: [
    "ILLUMINA",
    "OXFORD_NANOPORE",
    "PACBIO_SMRT",
    "ION_TORRENT",
    "ELEMENT",
    "DNBSEQ",
    "BGISEQ",
    "ULTIMA",
    "CAPILLARY",
  ],
  library_layout: ["PAIRED", "SINGLE"],
  library_strategy: ["AMPLICON", "WGS", "WGA", "WXS", "Targeted-Capture", "RNA-Seq", "OTHER"],
  library_source: [
    "GENOMIC",
    "GENOMIC SINGLE CELL",
    "TRANSCRIPTOMIC",
    "METAGENOMIC",
    "METATRANSCRIPTOMIC",
    "SYNTHETIC",
    "OTHER",
  ],
  library_selection: [
    "PCR",
    "RANDOM",
    "RANDOM PCR",
    "RT-PCR",
    "Hybrid Selection",
    "PolyA",
    "size fractionation",
    "other",
    "unspecified",
  ],
} as const;

// The schema's character classes use `A-z`, which also admits [ \ ] ^ _ and the backtick.
// They are copied as written so the form accepts exactly what validation accepts.
const NAME: FormatRule = {
  pattern: /^[A-z\-._0-9 ]+$/,
  hint: "letters, numbers, spaces and . _ -",
};
const NAME_NO_SPACE: FormatRule = {
  pattern: /^[A-z\-._0-9]+$/,
  hint: "letters, numbers and . _ - (no spaces)",
};
const PLAIN_TEXT: FormatRule = {
  pattern: /^[A-z\-._0-9(),/ ]+$/,
  hint: "letters, numbers, spaces and . _ - ( ) , /",
};
const PEOPLE: FormatRule = {
  pattern: /^[A-z\-._0-9;|(),/ ]+$/,
  hint: "letters, numbers, spaces and . _ - ; | ( ) , /",
};
const ARGUMENT: FormatRule = {
  pattern: /^[A-z\-._0-9{}(),/ ]+$/,
  hint: "letters, numbers, spaces and . _ - { } ( ) , /",
};
const URL_RULE: FormatRule = {
  pattern: /^(https?|ftp):\/\/[^\s/$.?#].[^\s]*$/,
  hint: "a web address starting with http://, https:// or ftp://",
};
const GENOME_URL: FormatRule = {
  pattern: /^(?:NA|(https?|ftp):\/\/[^\s/$.?#].[^\s]*)$/,
  hint: "a web address starting with http://, https:// or ftp://, or NA",
};
/**
 * Every date in the schema has the pattern
 * `\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12][0-9]|3[01]))?`: the day is
 * optional, so YYYY-MM is allowed. The pattern is not anchored, so it accepts
 * any text that contains a date; the app is stricter and wants the date alone.
 */
const DATE: FormatRule = {
  pattern: /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12][0-9]|3[01]))?$/,
  hint: "a date written YYYY-MM or YYYY-MM-DD",
};
/**
 * The schema gives `program_url` the plain-text pattern, which has no colon,
 * so no real web address passes validation. The form applies the schema as
 * it is and says so in the hint.
 */
const PROGRAM_URL: FormatRule = {
  pattern: PLAIN_TEXT.pattern,
  hint: "letters, numbers, spaces and . _ - ( ) , / (the PMO format does not allow a colon here, so leave out https://)",
};
const WHOLE_NUMBER: FormatRule = { pattern: /^\d+$/, hint: "whole numbers" };

/** Project fields (`ProjectInfo`). */
export const PROJECT_RECORD_FIELDS = [
  {
    key: "project_name",
    label: "Project name",
    description: "A short name for the project, which no other project may use.",
    required: true,
    kind: "text",
    format: NAME,
    example: "PRJNA1040019",
    aliases: ["name", "project", "study_name", "study", "project_id"],
  },
  {
    key: "project_description",
    label: "Description",
    description: "A short description of the project.",
    required: true,
    kind: "multiline",
    format: null,
    example: "Malaria surveillance in Mozambique",
    aliases: ["description", "study_description", "project_summary", "summary", "abstract"],
  },
  {
    key: "BioProject_accession",
    label: "BioProject accession",
    description: "The NCBI BioProject accession, such as PRJNA33823.",
    required: false,
    kind: "text",
    format: NAME,
    example: "PRJNA33823",
    aliases: ["bioproject", "bioproject_id", "ncbi_bioproject", "bioproject_accession_number"],
    group: "Details",
  },
  {
    key: "project_collector_chief_scientist",
    label: "Chief scientist",
    description: "The person who leads the project, or several names separated by semicolons.",
    required: false,
    kind: "text",
    format: PEOPLE,
    example: "Jane Doe; John Smith",
    aliases: ["chief_scientist", "collector", "principal_investigator", "pi", "lead_scientist"],
    group: "Details",
  },
  {
    key: "project_contributors",
    label: "Contributors",
    description: "People who contributed to the project.",
    required: false,
    kind: "list",
    format: NAME,
    example: "Jane Doe",
    aliases: ["contributors", "collaborators", "project_collaborators", "team_members", "authors"],
    group: "Details",
  },
  {
    key: "project_type",
    label: "Project type",
    description: "The kind of project, such as TES, surveillance or transmission.",
    required: false,
    kind: "text",
    format: NAME,
    example: "surveillance",
    aliases: ["study_type", "project_category", "research_type", "type"],
    group: "Details",
  },
] as const satisfies readonly RecordFieldDefinition[];

/** Sequencing fields (`SequencingInfo`). */
export const SEQUENCING_RECORD_FIELDS = [
  {
    key: "sequencing_info_name",
    label: "Sequencing run name",
    description: "A name for this sequencing run, as the library sample table gives it.",
    required: true,
    kind: "text",
    format: NAME,
    example: "run1",
    aliases: [
      "sequencing_info_id",
      "sequencing_name",
      "sequencing_run",
      "seq_info_name",
      "seq_run",
      "run_name",
      "sequencing_id",
    ],
  },
  {
    key: "seq_platform",
    label: "Platform",
    description: "The sequencing technology, such as ILLUMINA, OXFORD_NANOPORE or PACBIO_SMRT.",
    required: true,
    kind: "text",
    format: NAME,
    example: "ILLUMINA",
    suggestions: SEQUENCING_VOCABULARIES.seq_platform,
    aliases: ["platform", "sequencing_platform", "instrument_platform", "technology"],
  },
  {
    key: "seq_instrument_model",
    label: "Instrument model",
    description: "The sequencer model, such as NextSeq 2000, MinION or Revio.",
    required: true,
    kind: "text",
    format: NAME,
    example: "NextSeq 2000",
    aliases: ["instrument_model", "instrument", "sequencer", "sequencer_model", "model"],
  },
  {
    key: "library_layout",
    label: "Library layout",
    description: "How reads are arranged: PAIRED or SINGLE.",
    required: true,
    kind: "text",
    format: NAME,
    example: "PAIRED",
    suggestions: SEQUENCING_VOCABULARIES.library_layout,
    aliases: ["layout", "read_layout", "paired_end", "read_type"],
  },
  {
    key: "library_strategy",
    label: "Library strategy",
    description: "The sequencing strategy, such as AMPLICON or WGS.",
    required: true,
    kind: "text",
    format: NAME,
    example: "AMPLICON",
    suggestions: SEQUENCING_VOCABULARIES.library_strategy,
    aliases: ["strategy", "seq_strategy", "sequencing_strategy"],
  },
  {
    key: "library_source",
    label: "Library source",
    description: "The source material, such as GENOMIC or TRANSCRIPTOMIC.",
    required: true,
    kind: "text",
    format: NAME,
    example: "GENOMIC",
    suggestions: SEQUENCING_VOCABULARIES.library_source,
    aliases: ["source", "seq_source", "nucleic_acid_source"],
  },
  {
    key: "library_selection",
    label: "Library selection",
    description: "How the material was selected, such as PCR or RANDOM.",
    required: true,
    kind: "text",
    format: NAME,
    example: "PCR",
    suggestions: SEQUENCING_VOCABULARIES.library_selection,
    aliases: ["selection", "seq_selection", "selection_method"],
  },
  {
    key: "library_kit",
    label: "Library kit",
    description: "The kit used to prepare libraries, with its version and part number if known.",
    required: false,
    kind: "text",
    format: PLAIN_TEXT,
    example: "MiSeq Reagent Kit v3 (150-cycle)",
    aliases: ["kit", "library_preparation_kit", "prep_kit", "library_prep_kit"],
    group: "Library preparation",
  },
  {
    key: "library_screen",
    label: "Library screening",
    description: "Enrichment, screening or normalisation applied to the libraries.",
    required: false,
    kind: "text",
    format: PLAIN_TEXT,
    example: "size selection 390bp",
    aliases: ["screen", "normalization", "normalisation", "enrichment"],
    group: "Library preparation",
  },
  {
    key: "pcr_cond",
    label: "PCR conditions",
    description: "The PCR method and conditions, such as the number of cycles.",
    required: false,
    kind: "text",
    format: PLAIN_TEXT,
    example: "30 cycles",
    aliases: ["pcr_conditions", "pcr_cycles", "pcr_protocol"],
    group: "Library preparation",
  },
  {
    key: "nucl_acid_ext",
    label: "Extraction method link",
    description: "A link to the method or kit used to extract nucleic acids.",
    required: false,
    kind: "url",
    format: URL_RULE,
    example: "https://example.org/extraction",
    aliases: ["extraction", "extraction_method", "nucleic_acid_extraction", "ext_method"],
    group: "Extraction and amplification",
  },
  {
    key: "nucl_acid_ext_date",
    label: "Extraction date",
    description: "When nucleic acids were extracted.",
    required: false,
    kind: "date",
    format: DATE,
    example: "2024-01-15",
    aliases: ["extraction_date", "ext_date"],
    group: "Extraction and amplification",
  },
  {
    key: "nucl_acid_amp",
    label: "Amplification method link",
    description: "A link to the method or kit used to amplify nucleic acids.",
    required: false,
    kind: "url",
    format: URL_RULE,
    example: "https://example.org/amplification",
    aliases: ["amplification", "amplification_method", "nucleic_acid_amplification", "amp_method"],
    group: "Extraction and amplification",
  },
  {
    key: "nucl_acid_amp_date",
    label: "Amplification date",
    description: "When nucleic acids were amplified.",
    required: false,
    kind: "date",
    format: DATE,
    example: "2024-01-16",
    aliases: ["amplification_date", "amp_date"],
    group: "Extraction and amplification",
  },
  {
    key: "seq_center",
    label: "Sequencing centre",
    description: "The lab, core facility or company that did the sequencing.",
    required: false,
    kind: "text",
    format: PLAIN_TEXT,
    example: "UCSF Core",
    aliases: [
      "sequencing_center",
      "sequencing_centre",
      "center",
      "centre",
      "facility",
      "core_facility",
    ],
    group: "Sequencing",
  },
  {
    key: "seq_date",
    label: "Sequencing date",
    description: "When the sequencing was done.",
    required: false,
    kind: "date",
    format: DATE,
    example: "2024-02",
    aliases: ["sequencing_date", "date_sequenced", "run_date", "date"],
    group: "Sequencing",
  },
] as const satisfies readonly RecordFieldDefinition[];

/** Fields of one step of a bioinformatics method (`BioMethod`). */
export const METHOD_STEP_RECORD_FIELDS = [
  {
    key: "program",
    label: "Program",
    description: "The program used for this step.",
    required: true,
    kind: "text",
    format: NAME,
    example: "dada2",
    aliases: ["tool", "software", "program_name", "tool_name", "software_name"],
  },
  {
    key: "program_version",
    label: "Version",
    description: "The program's version, ideally written v1.2.3.",
    required: true,
    kind: "text",
    format: NAME,
    example: "v1.26.0",
    aliases: ["version", "tool_version", "software_version"],
  },
  {
    key: "program_description",
    label: "Description",
    description: "A short description of what this step does.",
    required: false,
    kind: "text",
    format: PLAIN_TEXT,
    example: "denoising",
    aliases: ["description", "method_description", "tool_description", "step"],
    group: "Details",
  },
  {
    key: "additional_argument",
    label: "Additional arguments",
    description: "Arguments that differ from the program's defaults.",
    required: false,
    kind: "list",
    format: ARGUMENT,
    example: "--maxEE 2",
    aliases: ["arguments", "args", "parameters", "params", "additional_arguments", "options"],
    group: "Details",
  },
  {
    key: "program_url",
    label: "Program link",
    description: "Where the program's code can be found, such as a GitHub page.",
    required: false,
    kind: "text",
    format: PROGRAM_URL,
    example: "github.com/benjjneb/dada2",
    aliases: ["url", "tool_url", "software_url", "program_link", "link", "github"],
    group: "Details",
  },
] as const satisfies readonly RecordFieldDefinition[];

/**
 * Fields of a bioinformatics run (`BioinformaticsRunInfo`), apart from its
 * method: `bioinformatics_methods_id` is an index the app assigns.
 */
export const RUN_RECORD_FIELDS = [
  {
    key: "bioinformatics_run_name",
    label: "Run name",
    description: "A name for this run of the pipeline, as used in the allele table.",
    required: true,
    kind: "text",
    format: NAME,
    example: "run1",
    aliases: [
      "run_name",
      "bioinfo_run_name",
      "bioinfo_run",
      "bioinfo_runs",
      "analysis_run_name",
      "analysis_name",
      "bioinformatics_run",
      "run",
    ],
  },
  {
    key: "run_date",
    label: "Run date",
    description: "When the pipeline was run.",
    required: false,
    kind: "date",
    format: DATE,
    example: "2024-03-01",
    aliases: ["date", "analysis_date", "pipeline_date", "bioinformatics_run_date"],
    group: "Details",
  },
] as const satisfies readonly RecordFieldDefinition[];

/** Fields of a reference genome (`GenomeInfo`). */
export const GENOME_RECORD_FIELDS = [
  {
    key: "name",
    label: "Genome name",
    description: "The name of the reference genome, such as 3D7.",
    required: true,
    kind: "text",
    format: NAME_NO_SPACE,
    example: "3D7",
    aliases: ["genome_name", "genome", "reference", "reference_genome", "strain"],
  },
  {
    key: "genome_version",
    label: "Genome version",
    description: "The version of the genome.",
    required: true,
    kind: "text",
    format: NAME_NO_SPACE,
    example: "2020_09",
    aliases: ["version", "genome_build", "build", "assembly_version"],
  },
  {
    key: "taxon_id",
    label: "Taxon ID",
    description:
      "The NCBI taxonomy number of the organism, such as 5833, or several for a combined genome.",
    required: true,
    kind: "integerList",
    format: WHOLE_NUMBER,
    example: "5833",
    aliases: ["taxon", "ncbi_taxon_id", "taxonomy_id", "species_id"],
  },
  {
    key: "url",
    label: "Genome link",
    description: "Where the genome file can be downloaded, or NA.",
    required: true,
    kind: "url",
    format: GENOME_URL,
    example:
      "https://plasmodb.org/common/downloads/release-65/Pfalciparum3D7/fasta/data/PlasmoDB-65_Pfalciparum3D7_Genome.fasta",
    aliases: ["genome_url", "genome_link", "fasta_url", "link", "download_url"],
  },
  {
    key: "gff_url",
    label: "Annotation link",
    description: "Where the genome's annotation (GFF) file can be downloaded.",
    required: false,
    kind: "url",
    format: URL_RULE,
    example:
      "https://plasmodb.org/common/downloads/release-65/Pfalciparum3D7/gff/data/PlasmoDB-65_Pfalciparum3D7.gff",
    aliases: ["gff_link", "gff", "annotation_url", "gff_file"],
    group: "Details",
  },
  {
    key: "chromosomes",
    label: "Chromosomes",
    description: "The chromosomes or contigs in the genome.",
    required: false,
    kind: "list",
    format: NAME_NO_SPACE,
    example: "Pf3D7_01_v3",
    aliases: ["chroms", "chromosome", "contigs", "chromosome_names"],
    group: "Details",
  },
] as const satisfies readonly RecordFieldDefinition[];

const COLUMN_KINDS: Readonly<Record<FormFieldKind, FieldKind>> = {
  text: "text",
  multiline: "text",
  url: "text",
  date: "date",
  list: "list",
  // A single inferred number is the usual case; a cell with several is read as a list.
  integerList: "integer",
};

/**
 * A field's description, ending with how the value is entered there: lists
 * one per line in a form and separated by commas in a table, dates as
 * YYYY-MM or YYYY-MM-DD. Still one sentence.
 */
function describe(field: FormFieldSpec, where: "form" | "column"): string {
  const sentence = field.description.replace(/\.$/, "");
  if (field.kind === "list" || field.kind === "integerList") {
    return `${sentence}, ${where === "form" ? "one per line" : "separated by commas"}.`;
  }
  if (field.kind === "date") return `${sentence}, as YYYY-MM or YYYY-MM-DD.`;
  return `${sentence}.`;
}

/** The fields a form shows, from their definitions. */
export function toFormFields<K extends string>(
  definitions: readonly RecordFieldDefinition<K>[],
): FormFieldSpec<K>[] {
  return definitions.map(({ aliases: _aliases, group: _group, ...field }) => ({
    ...field,
    description: describe(field, "form"),
  }));
}

/** The fields a table column can be matched to, from their definitions. */
export function toColumnFields<K extends string>(
  definitions: readonly RecordFieldDefinition<K>[],
): KeyedFieldSpec<K>[] {
  return definitions.map((field) => ({
    key: field.key,
    label: field.label,
    description: describe(field, "column"),
    required: field.required,
    kind: COLUMN_KINDS[field.kind],
    aliases: field.aliases,
    ...(field.group === undefined ? {} : { group: field.group }),
  }));
}
