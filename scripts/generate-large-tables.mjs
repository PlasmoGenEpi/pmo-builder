// Writes a large, realistic set of tables for load testing, shaped like the
// MAD4HATTER example in public/examples:
//
//   allele table:   about 400 samples x 250 targets x a few alleles each
//                   (300,000 rows by default), sequences of 150 to 300 bases
//   panel table:    one row per target
//   metadata table: one row per sample (specimen and library sample columns)
//
// Usage: node scripts/generate-large-tables.mjs [outDir] [--rows N]
// Default outDir: pmo-builder-large-tables in the system temporary folder.
// The output is deterministic.
import { createWriteStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";
import { tmpdir } from "node:os";

const args = process.argv.slice(2);
const rowsFlag = args.indexOf("--rows");
const targetRows = rowsFlag === -1 ? 300_000 : Number(args[rowsFlag + 1]);
const outDir = args.find((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--rows");
const out = outDir ?? join(tmpdir(), "pmo-builder-large-tables");

const TARGETS = 250;
/** Samples scale with the row count, so smaller files keep the same shape. */
const SAMPLES = Math.max(1, Math.round((400 * targetRows) / 300_000));
const ALLELES_PER_TARGET = 8;

/** Mulberry32: a small seeded generator, so every run writes the same files. */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rand = random(20_261_114);
const pick = (items) => items[Math.floor(rand() * items.length)];
const between = (low, high) => low + Math.floor(rand() * (high - low + 1));
const bases = "ACGT";
const sequence = (length) => {
  let seq = "";
  for (let i = 0; i < length; i += 1) seq += bases[Math.floor(rand() * 4)];
  return seq;
};

/** Changes a few bases, as a real allele differs from another. */
const mutate = (seq) => {
  const chars = seq.split("");
  const changes = between(1, 4);
  for (let i = 0; i < changes; i += 1) chars[between(0, chars.length - 1)] = pick(bases.split(""));
  return chars.join("");
};

mkdirSync(out, { recursive: true });

// Targets: name, location, primers, alleles.
const targets = [];
for (let index = 0; index < TARGETS; index += 1) {
  const chrom = String(1 + (index % 14)).padStart(2, "0");
  const start = 100_000 + index * 7919;
  const length = between(150, 300);
  const name = `Pf3D7_${chrom}_v3-${start}-${start + length + 40}-1A`;
  const reference = sequence(length);
  const alleles = [reference];
  while (alleles.length < ALLELES_PER_TARGET) {
    const allele = mutate(reference);
    if (!alleles.includes(allele)) alleles.push(allele);
  }
  targets.push({ name, chrom, start, length, alleles, fwd: sequence(24), rev: sequence(26) });
}

const samples = Array.from({ length: SAMPLES }, (_, index) => ({
  library: `SRR${String(26_800_000 + index * 7)}`,
  specimen: `SAMN${String(38_200_000 + index * 3)}`,
}));

// Allele table: CSV, one row per sample, target and allele.
const alleleFile = join(out, "large_allele_table.csv");
const stream = createWriteStream(alleleFile);
let written = 0;
let buffer = "SampleID,Locus,ASV,Reads\n";
const rowsPerSample = targetRows / SAMPLES;
const allelesPerPair = rowsPerSample / TARGETS;
for (const sample of samples) {
  for (const target of targets) {
    // A whole number of alleles averaging allelesPerPair, at least one.
    const base = Math.floor(allelesPerPair);
    const count = Math.max(1, base + (rand() < allelesPerPair - base ? 1 : 0));
    // The reference allele, then others with no repeats.
    const others = Array.from({ length: ALLELES_PER_TARGET - 1 }, (_, i) => i + 1).toSorted(
      () => rand() - 0.5,
    );
    for (let allele = 0; allele < count && written < targetRows; allele += 1) {
      const which = allele === 0 ? 0 : others[allele - 1];
      buffer += `${sample.library},${target.name},${target.alleles[which]},${between(1, 4000)}\n`;
      written += 1;
    }
    if (buffer.length > 1_000_000) {
      // oxlint-disable-next-line no-await-in-loop -- waits for the file to drain
      if (!stream.write(buffer)) await once(stream, "drain");
      buffer = "";
    }
  }
}
stream.end(buffer);
await once(stream, "finish");

// Panel table, as mad4hatter_panel_info_example.csv (tab-separated there; CSV here).
const panelLines = [
  "amplicon,amplicon_start,amplicon_end,ampInsert_start,ampInsert_end,rev_primer,amplicon_length,ampInsert_length,fwd_primer,target_type",
];
for (const target of targets) {
  const end = target.start + target.length + 40;
  panelLines.push(
    [
      target.name,
      target.start,
      end,
      target.start + 20,
      end - 20,
      target.rev,
      end - target.start,
      target.length,
      target.fwd,
      pick(["diversity", "resistance", "diagnostic"]),
    ].join(","),
  );
}
const panelFile = join(out, "large_panel_table.csv");
writeFileSync(panelFile, `${panelLines.join("\n")}\n`);

// Metadata table, as mad4hatter_metadata_example.tsv.
const metadataLines = [
  [
    "specimen_id",
    "collection_date",
    "collection_country",
    "samp_collect_device",
    "lat_lon",
    "geo_admin3",
    "host_taxon_id",
    "project_name",
    "samp_store_loc",
    "samp_taxon_id",
    "experiment_sample_id",
    "panel_id",
    "plate_name",
    "plate_row",
    "plate_col",
    "sequencing_info_id",
  ].join("\t"),
];
samples.forEach((sample, index) => {
  metadataLines.push(
    [
      sample.specimen,
      `20${between(15, 24)}-${String(between(1, 12)).padStart(2, "0")}`,
      pick(["Mozambique", "Kenya", "Uganda", "Ghana"]),
      "dried blood spot",
      "25.58,32.35",
      pick(["Maputo", "Kisumu", "Tororo", "Kumasi"]),
      "9606",
      "PRJNA1040019",
      "Lab freezer 3",
      "5833",
      sample.library,
      "Mad4hatter",
      `plate${1 + Math.floor(index / 96)}`,
      "ABCDEFGH"[Math.floor((index % 96) / 12)],
      String(1 + (index % 12)),
      "run1",
    ].join("\t"),
  );
});
const metadataFile = join(out, "large_metadata_table.tsv");
writeFileSync(metadataFile, `${metadataLines.join("\n")}\n`);

const mb = (file) => (statSync(file).size / 1_048_576).toFixed(1);
console.log(
  `${alleleFile}: ${written} rows, ${SAMPLES} samples, ${TARGETS} targets, ${mb(alleleFile)} MB`,
);
console.log(`${panelFile}: ${TARGETS} rows`);
console.log(`${metadataFile}: ${SAMPLES} rows`);
