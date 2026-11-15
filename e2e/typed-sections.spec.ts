/**
 * From an empty draft to a downloaded PMO with the typed-in sections: the
 * allele and panel files are uploaded, the project, a sequencing run and a
 * bioinformatics method and run are typed in, and the downloaded file is
 * checked with `validatePmo` and `checkPmoIntegrity` from pmotools-ts. The
 * privacy fixture fails the test on any request to another origin.
 *
 * With no sample table, the one project and the one sequencing run apply to
 * every specimen and library sample, and the app says so. A second case
 * uploads the sample table, whose rows name the project and the run, and
 * checks that the records are linked by those names.
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import type { Page } from "@playwright/test";
import { checkPmoIntegrity, validatePmo, type PortableMicrohaplotypeObject } from "pmotools-ts";

import { expect, test } from "./fixtures/privacy";
import { BUILD_TIMEOUT, downloadFrom, openStep, verdictCard } from "./support/review";

const ALLELE_TABLE = fileURLToPath(
  new URL("../public/examples/mad4hatter_allele_data_example.csv", import.meta.url),
);
const PANEL_TABLE = fileURLToPath(
  new URL("../public/examples/mad4hatter_panel_info_example.csv", import.meta.url),
);
const SAMPLE_TABLE = fileURLToPath(
  new URL("../public/examples/mad4hatter_metadata_example.tsv", import.meta.url),
);

/** Types each value into the field labelled with it, then leaves the field so it is committed. */
async function fill(page: Page, values: Readonly<Record<string, string>>): Promise<void> {
  for (const [label, value] of Object.entries(values)) {
    const field = page.getByLabel(new RegExp(`^${label}`)).first();
    // oxlint-disable-next-line no-await-in-loop -- fields are filled one after another, as a user would.
    await field.fill(value);
    // oxlint-disable-next-line no-await-in-loop -- fields are filled one after another, as a user would.
    await field.blur();
  }
}

/** Waits for the step's own result to say it is ready. */
async function expectStepReady(page: Page): Promise<void> {
  await expect(
    page.getByRole("region", { name: "Result" }).getByText("Ready", { exact: true }),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });
}

/** Uploads the allele and panel tables, with one run name for the allele table. */
async function uploadRequired(page: Page): Promise<void> {
  await page.goto("/#/build/microhaplotypes");
  await expect(page.getByRole("heading", { level: 1, name: "Microhaplotypes" })).toBeVisible();
  await page.getByLabel("Choose allele table file").setInputFiles(ALLELE_TABLE);
  await expectStepReady(page);
  await page.getByRole("radio", { name: /One name for the whole table/ }).click();
  await page.getByRole("textbox", { name: "Run name" }).fill("mad4hatter_run_1");

  await openStep(page, "Panel");
  await page.getByLabel("Choose target table file").setInputFiles(PANEL_TABLE);
  await page.getByRole("textbox", { name: "Panel name" }).fill("Mad4hatter");
  await expectStepReady(page);
}

/** Types one project and one sequencing run, with the names the example sample table uses. */
async function typeProjectAndRun(page: Page): Promise<void> {
  await openStep(page, "Project");
  await fill(page, {
    "Project name": "PRJNA1040019",
    Description: "Amplicon sequencing of dried blood spots",
  });
  await expectStepReady(page);

  await openStep(page, "Sequencing");
  await fill(page, {
    "Sequencing run name": "run1",
    Platform: "ILLUMINA",
    "Instrument model": "NextSeq 2000",
    "Library layout": "PAIRED",
    "Library strategy": "AMPLICON",
    "Library source": "GENOMIC",
    "Library selection": "PCR",
  });
  await expectStepReady(page);
}

/** Downloads the PMO from the review page and checks it with pmotools-ts. */
async function downloadValidPmo(page: Page): Promise<PortableMicrohaplotypeObject> {
  await openStep(page, "Review and download");
  const verdict = verdictCard(page);
  await expect(verdict.getByRole("heading", { name: /^Ready/ })).toBeVisible({
    timeout: BUILD_TIMEOUT,
  });
  const download = await downloadFrom(page, verdict.getByRole("button", { name: "Download PMO" }));
  const raw = await readFile(await download.path());
  const parsed: unknown = JSON.parse(gunzipSync(raw).toString("utf8"));
  const validation = validatePmo(parsed);
  expect(validation.valid ? [] : validation.errors.slice(0, 3)).toEqual([]);
  if (!validation.valid) throw new Error("The PMO is not valid");
  expect(checkPmoIntegrity(validation.pmo).filter((issue) => issue.severity === "error")).toEqual(
    [],
  );
  return validation.pmo;
}

test("an empty draft with uploaded tables and typed sections downloads as a valid PMO", async ({
  page,
  privacy,
}) => {
  test.setTimeout(120_000);
  await uploadRequired(page);
  await typeProjectAndRun(page);
  // No sample table names a project, so the one project applies to every specimen.
  await expect(
    page.getByText(
      'Sequencing run "run1" is applied to all 49 library samples, because there is no library sample table to name a run for each.',
    ),
  ).toBeVisible({ timeout: BUILD_TIMEOUT });

  await openStep(page, "Bioinformatics");
  await fill(page, {
    "Method name": "mad4hatter",
    Program: "dada2",
    Version: "v1.26.0",
    "Run name": "mad4hatter_run_1",
  });
  await expectStepReady(page);

  const pmo = await downloadValidPmo(page);
  const check = page.getByRole("region", { name: "Things to check" });
  await expect(
    check.getByText(
      'Project "PRJNA1040019" is applied to all 49 specimens, because there is no specimen table to name a project for each.',
    ),
  ).toBeVisible();
  expect(pmo.specimen_info).toHaveLength(49);
  expect(pmo.specimen_info.every((specimen) => specimen["project_id"] === 0)).toBe(true);
  expect(pmo.library_sample_info.every((library) => library["sequencing_info_id"] === 0)).toBe(
    true,
  );
  expect(pmo.project_info).toEqual([
    expect.objectContaining({
      project_name: "PRJNA1040019",
      project_description: "Amplicon sequencing of dried blood spots",
    }),
  ]);
  expect(pmo.sequencing_info).toEqual([
    expect.objectContaining({
      sequencing_info_name: "run1",
      seq_platform: "ILLUMINA",
      seq_instrument_model: "NextSeq 2000",
      library_layout: "PAIRED",
      library_strategy: "AMPLICON",
      library_source: "GENOMIC",
      library_selection: "PCR",
    }),
  ]);
  expect(pmo.bioinformatics_methods_info).toHaveLength(1);
  expect(JSON.stringify(pmo.bioinformatics_methods_info)).toContain('"program":"dada2"');
  expect(pmo.bioinformatics_run_info).toEqual([
    expect.objectContaining({ bioinformatics_run_name: "mad4hatter_run_1" }),
  ]);
  expect(pmo.panel_info).toEqual([expect.objectContaining({ panel_name: "Mad4hatter" })]);
  expect(pmo.target_info).toHaveLength(276);
  expect(privacy.crossOriginRequests).toEqual([]);
});

test("a sample table that names the project and run links each record by name", async ({
  page,
  privacy,
}) => {
  test.setTimeout(120_000);
  await uploadRequired(page);
  await openStep(page, "Specimens");
  await page.getByLabel("Choose specimen table file").setInputFiles(SAMPLE_TABLE);
  await expectStepReady(page);
  await openStep(page, "Library samples");
  await page.getByLabel("Choose library sample table file").setInputFiles(SAMPLE_TABLE);
  await expectStepReady(page);
  await typeProjectAndRun(page);
  await expect(page.getByText(/is applied to all/)).toHaveCount(0);

  const pmo = await downloadValidPmo(page);
  expect(pmo.project_info).toEqual([expect.objectContaining({ project_name: "PRJNA1040019" })]);
  expect(pmo.specimen_info).toHaveLength(50);
  expect(pmo.specimen_info.every((specimen) => specimen["project_id"] === 0)).toBe(true);
  expect(pmo.library_sample_info.every((library) => library["sequencing_info_id"] === 0)).toBe(
    true,
  );
  expect(privacy.crossOriginRequests).toEqual([]);
});
