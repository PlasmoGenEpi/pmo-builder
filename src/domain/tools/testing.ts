/**
 * A small PMO for the tests of this folder, with optional fields filled in
 * for some records and left out for others, as real files do.
 *
 * Three specimens and library samples (S1, S2, S3) and three targets
 * (t1, t2, t3). S3's specimen is a negative control with a few reads.
 * Only S1 and S2 have a plate position, a density and a collection place;
 * S3's specimen has a year but no month.
 */
import type { PortableMicrohaplotypeObject } from "pmotools-ts";

/** The PMO described above. */
export function richPmo(): PortableMicrohaplotypeObject {
  return {
    pmo_header: { pmo_version: "1.1.0" },
    panel_info: [
      {
        panel_name: "p",
        reactions: [
          { reaction_name: "pool1", panel_targets: [0, 1] },
          { reaction_name: "pool2", panel_targets: [2] },
        ],
      },
    ],
    target_info: ["t1", "t2", "t3"].map((target_name) => ({
      target_name,
      forward_primer: { seq: "ACGT" },
      reverse_primer: { seq: "TGCA" },
    })),
    project_info: [{ project_name: "Study A", project_description: "d" }],
    specimen_info: [
      {
        specimen_name: "spec1",
        collection_country: "Mozambique",
        geo_admin1: "Maputo",
        collection_date: "2019-01-15",
        project_id: 0,
        specimen_type: "field_sample",
        parasite_density_info: [{ parasite_density: 1200, parasite_density_method: "microscopy" }],
      },
      {
        specimen_name: "spec2",
        collection_country: "Mozambique",
        geo_admin1: "Gaza",
        collection_date: "2019-03",
        project_id: 0,
      },
      { specimen_name: "neg", collection_date: "2020", specimen_type: "negative_control" },
    ],
    library_sample_info: [
      {
        library_sample_name: "S1",
        specimen_id: 0,
        panel_id: 0,
        library_prep_plate_info: { plate_name: "P1", plate_row: "a", plate_col: 1 },
      },
      {
        library_sample_name: "S2",
        specimen_id: 1,
        panel_id: 0,
        library_prep_plate_info: { plate_name: "P1", plate_row: "B", plate_col: 3 },
        qpcr_parasite_density_info: [{ parasite_density: 35, parasite_density_method: "qPCR" }],
      },
      { library_sample_name: "S3", specimen_id: 2, panel_id: 0 },
    ],
    bioinformatics_methods_info: [{ methods: [{ program: "x", program_version: "1" }] }],
    bioinformatics_run_info: [{ bioinformatics_run_name: "runA", bioinformatics_methods_id: 0 }],
    representative_microhaplotypes: {
      targets: [
        { target_id: 0, microhaplotypes: [{ seq: "AAAA" }, { seq: "AAAT" }] },
        { target_id: 1, microhaplotypes: [{ seq: "CCCC" }] },
      ],
    },
    detected_microhaplotypes: [
      {
        bioinformatics_run_id: 0,
        library_samples: [
          {
            library_sample_id: 0,
            target_results: [
              {
                mhaps_target_id: 0,
                mhaps: [
                  { mhap_id: 0, reads: 90 },
                  { mhap_id: 1, reads: 10 },
                ],
              },
            ],
          },
          {
            library_sample_id: 1,
            target_results: [
              { mhaps_target_id: 0, mhaps: [{ mhap_id: 0, reads: 50 }] },
              { mhaps_target_id: 1, mhaps: [{ mhap_id: 0, reads: 5 }] },
            ],
          },
          {
            library_sample_id: 2,
            target_results: [{ mhaps_target_id: 0, mhaps: [{ mhap_id: 1, reads: 3 }] }],
          },
        ],
      },
    ],
    read_counts_by_stage: [
      {
        bioinformatics_run_id: 0,
        read_counts_by_library_sample_by_stage: [
          {
            library_sample_id: 0,
            total_raw_count: 500,
            read_counts_for_targets: [
              {
                target_id: 0,
                stages: [
                  { stage: "demux", reads: 300 },
                  { stage: "denoised", reads: 100 },
                ],
              },
              { target_id: 1, stages: [{ stage: "demux", reads: 50 }] },
            ],
          },
        ],
      },
    ],
  };
}
