import { t } from "@lingui/core/macro";

import { defineFieldSet } from "./define";

/**
 * The panel table, one row per target. Keys are `panelInfoTableToPmo`
 * options without `Col`. `additionalTargetInfoCols` is fed by
 * `additionalColumns`.
 */
export const PANEL_TARGET_FIELDS = defineFieldSet({
  id: "panelTargets",
  title: t`Panel targets`,
  allowsAdditionalColumns: true,
  fields: [
    {
      key: "targetName",
      label: t`Target name`,
      description: t`The name of the target (amplicon or locus).`,
      required: true,
      kind: "text",
      aliases: [
        "target_id",
        "target",
        "amplicon",
        "amplicon_name",
        "amplicon_id",
        "locus",
        "locus_id",
        "marker_id",
        "mip_id",
      ],
    },
    {
      key: "forwardPrimersSeq",
      label: t`Forward primer`,
      description: t`The sequence of the forward primer.`,
      required: true,
      kind: "text",
      aliases: [
        "forward_primer_seq",
        "forward_primer",
        "forward_primers",
        "forward_primer_sequence",
        "fwd_primer",
        "fwd_primers",
        "fwd_primer_seq",
        "primer_forward",
        "primer_fwd",
        "extension_arm",
      ],
    },
    {
      key: "reversePrimersSeq",
      label: t`Reverse primer`,
      description: t`The sequence of the reverse primer.`,
      required: true,
      kind: "text",
      aliases: [
        "reverse_primer_seq",
        "reverse_primer",
        "reverse_primers",
        "reverse_primer_sequence",
        "rev_primer",
        "rev_primers",
        "rev_primer_seq",
        "primer_reverse",
        "primer_rev",
        "ligation_arm",
      ],
    },
    {
      key: "reactionName",
      label: t({
        message: "Reaction",
        comment: "Field label: the PCR reaction or pool a target is amplified in",
      }),
      description: t`The PCR reaction or pool the target is amplified in.`,
      required: false,
      kind: "text",
      aliases: ["reaction", "reaction_id", "reactions", "pcr_reaction_name", "pool", "primer_pool"],
      group: t({
        message: "Reactions",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "forwardPrimersStart",
      label: t`Forward primer start`,
      description: t`Where the forward primer starts on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "forward_primer_start",
        "fwd_primer_start",
        "genomic_forward_primer_start",
        "forward_primer_genomic_start_coordinate",
      ],
      group: t({
        message: "Primer locations",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "forwardPrimersEnd",
      label: t`Forward primer end`,
      description: t`Where the forward primer ends on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "forward_primer_end",
        "fwd_primer_end",
        "genomic_forward_primer_end",
        "forward_primer_genomic_end_coordinate",
      ],
      group: t({
        message: "Primer locations",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "reversePrimersStart",
      label: t`Reverse primer start`,
      description: t`Where the reverse primer starts on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "reverse_primer_start",
        "rev_primer_start",
        "genomic_reverse_primer_start",
        "reverse_primer_genomic_start_coordinate",
      ],
      group: t({
        message: "Primer locations",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "reversePrimersEnd",
      label: t`Reverse primer end`,
      description: t`Where the reverse primer ends on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "reverse_primer_end",
        "rev_primer_end",
        "genomic_reverse_primer_end",
        "reverse_primer_genomic_end_coordinate",
      ],
      group: t({
        message: "Primer locations",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "insertStart",
      label: t`Insert start`,
      description: t`Where the stretch between the two primers starts on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "amp_insert_start",
        "genomic_insert_start",
        "insert_genomic_start_coordinate",
        "insert_location_start",
      ],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "insertEnd",
      label: t`Insert end`,
      description: t`Where the stretch between the two primers ends on the chromosome.`,
      required: false,
      kind: "integer",
      aliases: [
        "amp_insert_end",
        "genomic_insert_end",
        "insert_genomic_end_coordinate",
        "insert_location_end",
      ],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "chrom",
      label: t({
        message: "Chromosome",
        comment: "Field label: the chromosome a target or allele lies on",
      }),
      description: t`The chromosome the target lies on, needed when any location is given.`,
      required: false,
      kind: "text",
      aliases: ["chromosome", "chr", "contig", "amplicon_chrom", "gene_chrom"],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "strand",
      label: t({ message: "Strand", comment: "Field label: the DNA strand, + or -" }),
      description: t`The strand the target lies on, + or -.`,
      required: false,
      kind: "text",
      aliases: ["amplicon_strand", "gene_strand", "gene_genomic_strand", "orientation"],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "refSeq",
      label: t`Reference sequence`,
      description: t`The reference genome sequence of the target.`,
      required: false,
      kind: "text",
      aliases: ["reference_sequence", "reference_seq", "ref_sequence"],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "genomeId",
      label: t`Genome number`,
      description: t`Which reference genome the location refers to, counting from 0.`,
      required: false,
      kind: "integer",
      aliases: ["genome_index", "genome"],
      group: t({
        message: "Target location",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "geneName",
      label: t({ message: "Gene", comment: "Field label: the gene a target covers" }),
      description: t`The gene the target covers, if any.`,
      required: false,
      kind: "text",
      aliases: ["gene", "gene_id", "amplicon_gene"],
      group: t({
        message: "Target details",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
    {
      key: "targetAttributes",
      label: t`Target type`,
      description: t`Labels for the kind of target, such as diversity or resistance, separated by commas.`,
      required: false,
      kind: "list",
      aliases: [
        "target_type",
        "target_types",
        "attributes",
        "amplicon_type",
        "gene_type",
        "target_category",
      ],
      group: t({
        message: "Target details",
        comment: "Heading for a group of optional fields in the column-matching editor",
      }),
    },
  ],
  // The checks `panelInfoTableToPmo` makes on its location options.
  dependencies: [
    {
      id: "insert-location",
      when: ["insertStart", "insertEnd"],
      needs: ["chrom", "insertStart", "insertEnd"],
    },
    {
      id: "forward-primer-location",
      when: ["forwardPrimersStart", "forwardPrimersEnd"],
      needs: ["chrom", "forwardPrimersStart", "forwardPrimersEnd"],
    },
    {
      id: "reverse-primer-location",
      when: ["reversePrimersStart", "reversePrimersEnd"],
      needs: ["chrom", "reversePrimersStart", "reversePrimersEnd"],
    },
    { id: "strand", when: ["strand"], needs: ["chrom"] },
    {
      // Not a builder check: the reference sequence is only written on the insert location.
      id: "reference-sequence",
      when: ["refSeq"],
      needs: ["chrom", "insertStart", "insertEnd"],
    },
  ],
});
