import { t } from "@lingui/core/macro";

import { defineFieldSet, type KeyedFieldDependency } from "./define";

/**
 * Headers that name the library prep plate, which a specimen table often
 * carries because one sheet holds both. The storage plate fields must not be
 * suggested for them: `plate_row` scores 0.8 against `storagePlateRow`.
 */
const LIBRARY_PLATE_HEADERS = [
  "plate",
  "plate_name",
  "plate_id",
  "plate_row",
  "plate_col",
  "plate_column",
  "plate_position",
  "plate_well",
  "row",
  "col",
  "well",
] as const;

/** The schema needs a plate's name, row and column; a position stands for row and column. */
function plateDependencies<K extends string>(fields: {
  readonly name: K;
  readonly row: K;
  readonly col: K;
  readonly position: K;
}): KeyedFieldDependency<K>[] {
  return [
    {
      id: "plate-row-column",
      when: [fields.row, fields.col],
      needs: [fields.name, fields.row, fields.col],
    },
    { id: "plate-position", when: [fields.position], needs: [fields.name, fields.position] },
    {
      id: "plate-name",
      when: [fields.name],
      needs: [fields.name, { anyOf: [fields.position, fields.row] }],
    },
  ];
}

/**
 * The specimen table. Keys are `specimenInfoTableToPmo` options without `Col`.
 * `additionalSpecimenCols` is fed by `additionalColumns`.
 */
export const SPECIMEN_FIELDS = defineFieldSet({
  id: "specimens",
  title: t`Specimens`,
  allowsAdditionalColumns: true,
  fields: [
    {
      key: "specimenName",
      label: t`Specimen name`,
      description: t`A name for the specimen that is unique in this table.`,
      required: true,
      kind: "text",
      aliases: [
        "specimen_id",
        "specimen",
        "sample_id",
        "sample_name",
        "bio_id",
        "biosample_id",
        "biosample",
        "specimen_code",
      ],
    },
    {
      key: "collectionDate",
      label: t`Collection date`,
      description: t`When the specimen was collected, as YYYY, YYYY-MM or YYYY-MM-DD.`,
      required: false,
      kind: "date",
      aliases: [
        "date_of_collection",
        "sampling_date",
        "sample_date",
        "collected_date",
        "date_collected",
        "gathering_date",
      ],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "collectionCountry",
      label: t({
        message: "Country",
        comment: "Field label: the country a specimen was collected in",
      }),
      description: t`The country the specimen was collected in.`,
      required: false,
      kind: "text",
      aliases: [
        "country",
        "country_of_collection",
        "sampling_country",
        "origin_country",
        "admin_level_0",
        "geo_admin0",
      ],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "projectName",
      label: t({ message: "Project", comment: "Field label: the name of the research project" }),
      description: t`The name of the project the specimen belongs to.`,
      required: false,
      kind: "text",
      aliases: [
        "project",
        "project_id",
        "study_name",
        "study",
        "research_project",
        "experiment_name",
      ],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenTaxonId",
      label: t`Specimen taxon ID`,
      description: t`The NCBI taxonomy number of the organism in the specimen, such as 5833.`,
      required: false,
      // The schema wants a list of integers. The builder splits text on commas
      // and reads each part as a whole number, so "5833,5855" is allowed.
      kind: "integer",
      aliases: [
        "samp_taxon_id",
        "sample_taxon_id",
        "taxon_id",
        "species_id",
        "organism_id",
        "parasite_taxon_id",
      ],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenType",
      label: t`Specimen type`,
      description: t`What kind of specimen this is, such as field sample or negative control.`,
      required: false,
      kind: "text",
      aliases: ["sample_type", "samp_type", "type"],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenCollectDevice",
      label: t`Collection method`,
      description: t`How the specimen was collected, such as dried blood spot or whole blood.`,
      required: false,
      kind: "text",
      aliases: [
        "samp_collect_device",
        "collect_device",
        "collection_device",
        "collection_method",
        "sample_collection_method",
      ],
      group: t({
        message: "Collection",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "geoAdmin1",
      label: t({ message: "Region", comment: "Field label: the largest area within a country" }),
      description: t`The largest area within the country, such as a region or province.`,
      required: false,
      kind: "text",
      aliases: ["admin1", "admin_level_1", "region", "province", "state"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "geoAdmin2",
      label: t({ message: "District", comment: "Field label: an area within a region" }),
      description: t`The next smaller area, such as a district or county.`,
      required: false,
      kind: "text",
      aliases: ["admin2", "admin_level_2", "district", "county"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "geoAdmin3",
      label: t`Town or site`,
      description: t`The next smaller area, such as a town or health facility.`,
      required: false,
      kind: "text",
      aliases: ["admin3", "admin_level_3", "city", "town", "health_facility", "site"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "latLon",
      label: t`Latitude and longitude`,
      description: t`Where the specimen was collected, as latitude and longitude separated by a comma.`,
      required: false,
      kind: "text",
      aliases: ["latitude_longitude", "lat_long", "coordinates", "gps"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "envBroadScale",
      label: t`Broad environment`,
      description: t`The wider setting of the collection site, such as highlands or lowlands.`,
      required: false,
      kind: "text",
      aliases: ["environmental_broad_scale", "broad_environment"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "envLocalScale",
      label: t`Local environment`,
      description: t`The immediate setting of the collection site, such as urban or rural.`,
      required: false,
      kind: "text",
      aliases: ["environmental_local_scale", "local_environment"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "envMedium",
      label: t`Environment medium`,
      description: t`The material the specimen was taken from.`,
      required: false,
      kind: "text",
      aliases: ["environmental_medium", "environment_medium"],
      group: t({
        message: "Location",
        context: "place where a specimen was collected",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "hostTaxonId",
      label: t`Host taxon ID`,
      description: t`The NCBI taxonomy number of the host, such as 9606 for humans.`,
      required: false,
      kind: "integer",
      aliases: ["host_taxon", "host_species_id", "individual_taxon_id"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "hostSubjectName",
      label: t`Host ID`,
      description: t`An identifier for the person or animal the specimen came from.`,
      required: false,
      kind: "text",
      aliases: [
        "host_subject_id",
        "host_id",
        "host_name",
        "subject_id",
        "participant_id",
        "participant",
        "patient_id",
        "person",
      ],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "hostAge",
      label: t`Host age`,
      description: t`The age of the host in years, with decimals for babies such as 0.25.`,
      required: false,
      kind: "number",
      aliases: ["age", "age_years", "age_at_collection", "patient_age"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "hostSex",
      label: t`Host sex`,
      description: t`The sex of the host.`,
      required: false,
      kind: "text",
      aliases: ["sex", "gender", "host_gender"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "gravid",
      label: t({ message: "Pregnant", comment: "Field label: whether the host was pregnant" }),
      description: t`Whether the host was pregnant at collection, TRUE or FALSE.`,
      required: false,
      kind: "boolean",
      aliases: ["pregnant", "pregnancy_status", "is_pregnant"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "gravidity",
      label: t`Previous pregnancies`,
      description: t`How many times the host has been pregnant.`,
      required: false,
      kind: "integer",
      aliases: ["n_pregnancies", "n_pregnancies_at_collection", "number_of_pregnancies"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "bloodMeal",
      label: t`Recent blood meal`,
      description: t`Whether the host had a recent blood meal, TRUE or FALSE.`,
      required: false,
      kind: "boolean",
      aliases: ["blood_meal_status", "blood_fed"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "hasTravelOutSixMonth",
      label: t`Travelled in last six months`,
      description: t`Whether the host travelled away from the area in the last six months, TRUE or FALSE.`,
      required: false,
      kind: "boolean",
      aliases: ["travel", "travel_history", "travelled", "any_trips", "recent_travel"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "drugUsage",
      label: t`Drugs taken`,
      description: t`Any drugs the host took, separated by commas.`,
      required: false,
      kind: "list",
      aliases: ["drug_usage_status", "drugs", "drug_use", "medication"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "treatmentStatus",
      label: t`Treatment outcome`,
      description: t`The outcome of any treatment, separated by commas.`,
      required: false,
      kind: "list",
      aliases: ["treatment", "treated", "treatment_outcome"],
      group: t({
        message: "Host",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "parasiteDensity",
      label: t`Parasite density`,
      description: t`Parasites per microlitre of blood.`,
      required: false,
      kind: "number",
      aliases: ["parasitemia", "parasitaemia", "parasites_per_ul", "parasites/ul", "density"],
      group: t({
        message: "Parasite density",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "parasiteDensityMethod",
      label: t`Parasite density method`,
      description: t`How the parasite density was measured, such as microscopy or qPCR.`,
      required: false,
      kind: "text",
      aliases: ["density_method", "parasitemia_method"],
      group: t({
        message: "Parasite density",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenStoreLoc",
      label: t`Storage site`,
      description: t`Where the specimen is stored, such as a lab or freezer.`,
      required: false,
      kind: "text",
      aliases: [
        "samp_store_loc",
        "store_loc",
        "storage_location",
        "storage",
        "sample_location",
        "specimen_location",
      ],
      group: t({
        message: "Storage",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "storagePlateName",
      label: t`Storage plate`,
      description: t`The name of the plate the specimen is stored in.`,
      required: false,
      kind: "text",
      aliases: ["storage_plate", "store_plate_name"],
      notAliases: LIBRARY_PLATE_HEADERS,
      group: t({
        message: "Storage",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "storagePlateRow",
      label: t`Storage plate row`,
      description: t`The row letter of the specimen on its storage plate, such as A.`,
      required: false,
      kind: "text",
      aliases: ["store_plate_row"],
      notAliases: LIBRARY_PLATE_HEADERS,
      group: t({
        message: "Storage",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "storagePlateCol",
      label: t`Storage plate column`,
      description: t`The column number of the specimen on its storage plate, such as 1.`,
      required: false,
      kind: "integer",
      aliases: ["storage_plate_column", "store_plate_col"],
      notAliases: LIBRARY_PLATE_HEADERS,
      group: t({
        message: "Storage",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "storagePlatePosition",
      label: t`Storage plate position`,
      description: t`The well of the specimen on its storage plate, such as A01, instead of row and column.`,
      required: false,
      kind: "text",
      aliases: ["storage_plate_well", "storage_well", "store_plate_position"],
      notAliases: LIBRARY_PLATE_HEADERS,
      group: t({
        message: "Storage",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "alternateIdentifiers",
      label: t`Other names`,
      description: t`Other names for the specimen, separated by commas.`,
      required: false,
      kind: "list",
      aliases: ["alternate_ids", "alternative_ids", "aliases", "other_ids"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenAccession",
      label: t`Specimen accession`,
      description: t`The accession number if the specimen is in a public database.`,
      required: false,
      kind: "text",
      aliases: ["sample_accession", "biosample_accession", "accession"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "specimenComments",
      label: t({ message: "Comments", comment: "Field label: notes about a specimen" }),
      description: t`Any notes about the specimen, separated by commas.`,
      required: false,
      kind: "list",
      aliases: ["comments", "comment", "notes", "info", "extra_info"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
  ],
  dependencies: [
    // The schema needs both; the builder refuses a method without a density.
    {
      id: "parasite-density",
      when: ["parasiteDensity", "parasiteDensityMethod"],
      needs: ["parasiteDensity", "parasiteDensityMethod"],
    },
    ...plateDependencies({
      name: "storagePlateName",
      row: "storagePlateRow",
      col: "storagePlateCol",
      position: "storagePlatePosition",
    }),
  ],
});

/**
 * The library sample table. Keys are `librarySampleInfoTableToPmo` options
 * without `Col`. `additionalLibrarySampleInfoCols` is fed by
 * `additionalColumns`.
 */
export const LIBRARY_SAMPLE_FIELDS = defineFieldSet({
  id: "librarySamples",
  title: t`Library samples`,
  allowsAdditionalColumns: true,
  fields: [
    {
      key: "librarySampleName",
      label: t`Library sample name`,
      description: t`The name of the sequenced sample, as used in the allele table.`,
      required: true,
      kind: "text",
      aliases: [
        "library_sample_id",
        "library_id",
        "library_name",
        "experiment_sample_id",
        "sequencing_sample_id",
        "sample_name",
        "sample_id",
      ],
    },
    {
      key: "specimenName",
      label: t`Specimen name`,
      description: t`The specimen this library was made from, as named in the specimen table.`,
      required: true,
      kind: "text",
      aliases: ["specimen_id", "specimen", "bio_id", "biosample_id", "biosample", "specimen_code"],
    },
    {
      key: "panelName",
      label: t({ message: "Panel", comment: "Field label: the name of the sequencing panel" }),
      description: t`The name of the panel used to sequence this library.`,
      required: true,
      kind: "text",
      aliases: ["panel_id", "panel", "test_panel_id", "assay_id", "assay"],
    },
    {
      key: "sequencingInfoName",
      label: t`Sequencing run`,
      description: t`The name of the sequencing run, as given on the sequencing page.`,
      required: false,
      kind: "text",
      aliases: [
        "sequencing_info_id",
        "seq_info_id",
        "sequencing_id",
        "sequencing_run",
        "seq_run",
        "sequencing_run_name",
        "sequence_record_id",
      ],
      group: t({
        message: "Sequencing",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "fastqsLoc",
      label: t`FASTQ location`,
      description: t`Where the FASTQ files for this library are, as a path or link.`,
      required: false,
      kind: "text",
      aliases: ["fastqs_location", "fastq_location", "fastq_files", "fastqs", "fastq_path"],
      group: t({
        message: "Sequencing",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "libraryPrepPlateName",
      label: t`Library plate`,
      description: t`The name of the plate the library was prepared on.`,
      required: false,
      kind: "text",
      aliases: ["plate_name", "plate", "plate_id", "name_of_plate", "prep_plate"],
      group: t({
        message: "Plate",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "libraryPrepPlateRow",
      label: t`Library plate row`,
      description: t`The row letter of the library on its plate, such as A.`,
      required: false,
      kind: "text",
      aliases: ["plate_row", "row_of_plate", "row"],
      group: t({
        message: "Plate",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "libraryPrepPlateCol",
      label: t`Library plate column`,
      description: t`The column number of the library on its plate, such as 1.`,
      required: false,
      kind: "integer",
      aliases: ["plate_col", "plate_column", "column_of_plate", "col"],
      group: t({
        message: "Plate",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "libraryPrepPlatePosition",
      label: t`Library plate position`,
      description: t`The well of the library on its plate, such as A01, instead of row and column.`,
      required: false,
      kind: "text",
      aliases: ["plate_position", "position_on_plate", "plate_well", "well"],
      group: t({
        message: "Plate",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "parasiteDensity",
      label: t`Parasite density (qPCR)`,
      description: t`Parasites per microlitre measured from this extraction, for example by qPCR.`,
      required: false,
      kind: "number",
      aliases: [
        "qpcr_parasite_density",
        "qpcr_density",
        "parasitemia",
        "parasitaemia",
        "parasites/ul",
      ],
      group: t({
        message: "Parasite density",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "parasiteDensityMethod",
      label: t`Parasite density method`,
      description: t`How the parasite density was measured.`,
      required: false,
      kind: "text",
      aliases: ["density_method", "qpcr_method"],
      group: t({
        message: "Parasite density",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "alternateIdentifiers",
      label: t`Other names`,
      description: t`Other names for the library, separated by commas.`,
      required: false,
      kind: "list",
      aliases: ["alternate_ids", "alternative_ids", "aliases", "other_ids"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "experimentAccession",
      label: t`Experiment accession`,
      description: t`The SRA or ENA experiment accession, if the data was submitted.`,
      required: false,
      kind: "text",
      aliases: ["sra_experiment", "experiment_id", "accession_information"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "runAccession",
      label: t`Run accession`,
      description: t`The SRA or ENA run accession, such as SRR123456, if the data was submitted.`,
      required: false,
      kind: "text",
      aliases: ["run_accession_number", "sra_run", "srr", "sra_accession", "accession"],
      group: t({
        message: "Other",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
  ],
  dependencies: [
    {
      id: "parasite-density",
      when: ["parasiteDensity", "parasiteDensityMethod"],
      needs: ["parasiteDensity", "parasiteDensityMethod"],
    },
    ...plateDependencies({
      name: "libraryPrepPlateName",
      row: "libraryPrepPlateRow",
      col: "libraryPrepPlateCol",
      position: "libraryPrepPlatePosition",
    }),
  ],
});
