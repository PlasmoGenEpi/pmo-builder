import { plural, t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { ChartColumn, CloudUpload, Download, Plus, Scissors, Table, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { MergeSummary } from "@/domain/build/merge";
import type { PmoChoices, SubsetOutcome, SubsetPreview, SubsetRequest } from "@/domain/tools/types";
import { saveFile } from "@/features/review/saveFile";
import { useActions } from "@/state";
import {
  Button,
  Callout,
  Card,
  Checkbox,
  Field,
  IconButton,
  NumberField,
  RadioGroup,
  SectionHeading,
  Select,
  formatCount,
} from "@/ui";

import { NameChecklist } from "./NameChecklist";
import {
  formProblem,
  initialForm,
  keptSpecimens,
  requestOf,
  type Condition,
  type SpecimenMode,
  type SubsetForm,
  type TargetMode,
} from "./subsetModel";
import { useSettled } from "./useSettled";

function problemText(problem: ReturnType<typeof formProblem>): string | null {
  switch (problem) {
    case "no-specimens":
      return t`No specimen is chosen yet.`;
    case "no-targets":
      return t`No target is ticked yet.`;
    case "nothing-changed":
      return t`Choose some specimens or targets, or a minimum number of reads. As it stands the subset would be the whole file.`;
    case null:
    default:
      return null;
  }
}

function Conditions({
  choices,
  form,
  onChange,
}: {
  readonly choices: PmoChoices;
  readonly form: SubsetForm;
  readonly onChange: (conditions: Condition[]) => void;
}) {
  const used = new Set(form.conditions.map((condition) => condition.field));
  const unused = choices.metadata.filter((field) => !used.has(field.field));

  function update(index: number, next: Condition): void {
    onChange(form.conditions.map((condition, at) => (at === index ? next : condition)));
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        <Trans>
          A specimen is kept when it matches every condition: for each field, one of the ticked
          values.
        </Trans>
      </p>
      {form.conditions.map((condition, index) => {
        const field = choices.metadata.find((item) => item.field === condition.field);
        const fieldOptions = choices.metadata
          .filter((item) => item.field === condition.field || !used.has(item.field))
          .map((item) => ({ value: item.field, label: item.field }));
        const fieldName = condition.field;
        return (
          <Card key={condition.field} padding="sm" className="flex flex-col gap-3">
            <div className="flex items-end gap-2">
              <Field label={t`Field`} className="flex-1">
                {(control) => (
                  <Select
                    {...control}
                    options={fieldOptions}
                    value={condition.field}
                    onValueChange={(value) => update(index, { field: value, values: [] })}
                  />
                )}
              </Field>
              {form.conditions.length > 1 ? (
                <IconButton
                  icon={X}
                  label={t`Remove the condition on ${fieldName}`}
                  onClick={() => onChange(form.conditions.filter((_, at) => at !== index))}
                />
              ) : null}
            </div>
            <fieldset className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <legend className="sr-only">{t`Values of ${fieldName}`}</legend>
              {(field?.values ?? []).map((value) => {
                const count = value.count;
                return (
                  <Checkbox
                    key={value.value}
                    label={value.label}
                    description={plural(count, { one: "# specimen", other: "# specimens" })}
                    checked={condition.values.includes(value.value)}
                    onCheckedChange={(on) =>
                      update(index, {
                        field: condition.field,
                        values: on
                          ? [...condition.values, value.value]
                          : condition.values.filter((item) => item !== value.value),
                      })
                    }
                  />
                );
              })}
            </fieldset>
          </Card>
        );
      })}
      {unused.length > 0 ? (
        <Button
          size="sm"
          variant="secondary"
          icon={Plus}
          className="self-start"
          onClick={() =>
            onChange([...form.conditions, { field: unused[0]?.field ?? "", values: [] }])
          }
        >
          {t`Add a condition`}
        </Button>
      ) : null}
    </div>
  );
}

/** The counts a subset is described by. */
type SubsetCounts = Pick<MergeSummary, "specimens" | "librarySamples" | "targetsWithCalls">;

/** What the subset keeps of the original, as a sentence: once made, or before. */
function subsetSummary(
  summary: SubsetCounts,
  original: MergeSummary,
  when: "made" | "planned",
): string {
  const specimens = formatCount(summary.specimens);
  const allSpecimens = formatCount(original.specimens);
  const librarySamples = formatCount(summary.librarySamples);
  const allLibrarySamples = formatCount(original.librarySamples);
  const targets = formatCount(summary.targetsWithCalls);
  const allTargets = formatCount(original.targetsWithCalls);
  return when === "made"
    ? t({
        message: `It keeps ${specimens} of ${allSpecimens} specimens and ${librarySamples} of ${allLibrarySamples} library samples, with alleles at ${targets} of ${allTargets} targets.`,
        comment:
          "Each pair of numbers is what the subset keeps and what the whole file has. Targets are counted only when some allele was found at them.",
      })
    : t({
        message: `The subset will keep ${specimens} of ${allSpecimens} specimens and ${librarySamples} of ${allLibrarySamples} library samples, with alleles at ${targets} of ${allTargets} targets.`,
        comment:
          "Shown while choosing, before the subset is made. Each pair of numbers is what the subset would keep and what the whole file has. Targets are counted only when some allele was found at them.",
      });
}

function SubsetResult({
  outcome,
  original,
  onShowSummary,
  onShowTables,
  onPublish,
}: {
  readonly outcome: SubsetOutcome;
  readonly original: MergeSummary;
  readonly onShowSummary: () => void;
  readonly onShowTables: () => void;
  readonly onPublish: (() => void) | null;
}) {
  const actions = useActions();
  const [saving, setSaving] = useState<"gzip" | "json" | null>(null);
  const [failed, setFailed] = useState(false);

  async function download(gzip: boolean): Promise<void> {
    setSaving(gzip ? "gzip" : "json");
    setFailed(false);
    const file = await actions.workingPmoFile({ gzip });
    setSaving(null);
    if (file === null) setFailed(true);
    else saveFile(file.blob, file.fileName);
  }

  switch (outcome.kind) {
    case "made":
      return (
        <div className="flex flex-col gap-4">
          {outcome.problems.length === 0 ? (
            <Callout tone="success" live title={t`The subset is ready`}>
              {subsetSummary(outcome.summary, original, "made")}
            </Callout>
          ) : (
            <Callout tone="warning" live title={t`The subset does not pass every check`}>
              <ul className="list-disc pl-5">
                {outcome.problems.map((problem) => (
                  <li key={problem} className="break-words">
                    {problem}
                  </li>
                ))}
              </ul>
            </Callout>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={Download}
              loading={saving === "gzip"}
              onClick={() => void download(true)}
            >
              {t`Download the subset (.json.gz)`}
            </Button>
            <Button
              variant="secondary"
              loading={saving === "json"}
              onClick={() => void download(false)}
            >
              {t`Download as .json`}
            </Button>
          </div>
          {/* Pulled out by the ghost buttons' padding, so their text lines up with the rest. */}
          <div className="-mx-3 flex flex-wrap gap-1">
            <Button variant="ghost" icon={ChartColumn} onClick={onShowSummary}>
              {t`See its summary`}
            </Button>
            <Button variant="ghost" icon={Table} onClick={onShowTables}>
              {t`Download its tables`}
            </Button>
            {onPublish === null ? null : (
              <Button variant="ghost" icon={CloudUpload} onClick={onPublish}>
                {t`Publish the subset`}
              </Button>
            )}
          </div>
          {failed ? (
            <p role="alert" className="text-sm text-danger-text">
              {t`The file could not be made. Make the subset again.`}
            </p>
          ) : null}
        </div>
      );
    case "empty":
      return (
        <Callout tone="warning" live title={t`Nothing is left`}>
          <Trans>
            No library sample has any microhaplotypes left with these choices. Choose more specimens
            or targets, or fewer reads.
          </Trans>
        </Callout>
      );
    case "failed":
      return (
        <Callout tone="error" live title={t`The subset could not be made`}>
          {outcome.message}
        </Callout>
      );
    case "not-open":
      return (
        <Callout tone="error" live title={t`The file is no longer open`}>
          <Trans>Choose the file again.</Trans>
        </Callout>
      );
    default:
      return null;
  }
}

/**
 * What `request` would keep, counted in the worker once the form has settled.
 * While newer choices are being counted, the last counts are given as stale.
 * `null` before the first count, and while `enabled` is false.
 */
function useSubsetPreview(
  request: SubsetRequest,
  enabled: boolean,
): { readonly counts: SubsetPreview; readonly stale: boolean } | null {
  const actions = useActions();
  const settled = useSettled(request, 300);
  const [latest, setLatest] = useState<{
    readonly request: SubsetRequest;
    readonly counts: SubsetPreview;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    async function count(): Promise<void> {
      const counts = await actions.previewSubset(settled);
      if (live) setLatest(counts === null ? null : { request: settled, counts });
    }
    void count();
    return () => {
      live = false;
    };
  }, [actions, settled, enabled]);
  if (!enabled || latest === null) return null;
  return { counts: latest.counts, stale: latest.request !== request };
}

/** Props for {@link SubsetPanel}. */
export interface SubsetPanelProps {
  readonly choices: PmoChoices;
  /** What the whole file holds, to compare the subset with. */
  readonly original: MergeSummary;
  /** The latest subset made, kept by the page so it survives switching tabs. */
  readonly outcome: SubsetOutcome | null;
  readonly onMade: (outcome: SubsetOutcome | null) => void;
  readonly onShowSummary: () => void;
  readonly onShowTables: () => void;
  /** Opens publishing for the subset, or `null` when this copy cannot publish. */
  readonly onPublish: (() => void) | null;
}

/** Choosing specimens, targets and a read threshold, and making the subset. */
export function SubsetPanel({
  choices,
  original,
  outcome,
  onMade,
  onShowSummary,
  onShowTables,
  onPublish,
}: SubsetPanelProps) {
  const actions = useActions();
  const [form, setForm] = useState<SubsetForm>(() => initialForm(choices));
  const [making, setMaking] = useState(false);
  const kept = keptSpecimens(choices, form).length;
  const problem = formProblem(choices, form);
  const withData = choices.specimens.filter((specimen) => specimen.librarySamples > 0);
  const withoutData = choices.specimens.length - withData.length;
  const allCount = formatCount(withData.length);
  const keptCount = formatCount(kept);
  const targetCount = formatCount(choices.targets.length);
  const maxReads = formatCount(choices.maxReads);
  const targetsWithoutData = choices.targetsWithoutData;
  const request = useMemo(() => requestOf(form), [form]);
  const preview = useSubsetPreview(request, problem === null);
  const nothingLeft = preview?.counts.librarySamplesWithData === 0 && !preview.stale;

  function change(next: Partial<SubsetForm>): void {
    setForm((before) => ({ ...before, ...next }));
    onMade(null);
  }

  async function make(): Promise<void> {
    setMaking(true);
    const result = await actions.subsetPmo(request);
    setMaking(false);
    onMade(
      result ?? {
        kind: "failed",
        message: t`Something went wrong. Reload the page and try again.`,
      },
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <SectionHeading title={t`Specimens`} />
        <RadioGroup<SpecimenMode>
          label={t`Which specimens to keep`}
          value={form.specimenMode}
          onValueChange={(value) => change({ specimenMode: value })}
          options={[
            { value: "all", label: t`All specimens (${allCount})` },
            {
              value: "metadata",
              label: t`Specimens with certain values`,
              description:
                choices.metadata.length === 0
                  ? t`This file has no field with a few distinct values to choose by.`
                  : t`Such as the country or year of collection.`,
              disabled: choices.metadata.length === 0,
            },
            { value: "names", label: t`Specimens I tick` },
          ]}
        />
        {form.specimenMode === "metadata" ? (
          <Conditions
            choices={choices}
            form={form}
            onChange={(conditions) => change({ conditions })}
          />
        ) : null}
        {form.specimenMode === "names" ? (
          <NameChecklist
            label={t`Specimens`}
            items={withData.map((specimen) => {
              const count = specimen.librarySamples;
              return {
                name: specimen.name,
                detail: plural(count, { one: "# library sample", other: "# library samples" }),
              };
            })}
            selected={form.specimenNames}
            onChange={(specimenNames) => change({ specimenNames })}
          />
        ) : null}
        {form.specimenMode === "all" ? null : (
          <p className="text-sm font-medium text-text" aria-live="polite">
            {t`${keptCount} of ${allCount} specimens kept.`}
          </p>
        )}
        {withoutData > 0 ? (
          <p className="text-sm text-text-muted">
            {plural(withoutData, {
              one: "# specimen has no library sample, so no data, and is left out of any subset.",
              other:
                "# specimens have no library sample, so no data, and are left out of any subset.",
            })}
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title={t`Targets`} />
        <RadioGroup<TargetMode>
          label={t`Which targets to keep`}
          value={form.targetMode}
          onValueChange={(value) => change({ targetMode: value })}
          options={[
            { value: "all", label: t`All targets` },
            { value: "names", label: t`Targets I tick (${targetCount} with data)` },
          ]}
        />
        {form.targetMode === "names" ? (
          <>
            <NameChecklist
              label={t`Targets`}
              items={choices.targets.map((name) => ({ name }))}
              selected={form.targetNames}
              onChange={(targetNames) => change({ targetNames })}
            />
            {choices.targetsWithoutData > 0 ? (
              <p className="text-sm text-text-muted">
                {plural(targetsWithoutData, {
                  one: "# target has no microhaplotypes in this file, so it cannot be kept on its own and is not listed.",
                  other:
                    "# targets have no microhaplotypes in this file, so they cannot be kept on their own and are not listed.",
                })}
              </p>
            ) : null}
          </>
        ) : null}
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeading title={t`Reads`} />
        <NumberField
          label={t`Minimum reads per microhaplotype`}
          hint={t`Microhaplotypes with fewer reads are left out. Leave empty to keep them all. The most in this file is ${maxReads}.`}
          integer
          min={0}
          value={form.minReads}
          onValueChange={(minReads) => change({ minReads })}
          className="max-w-xs"
        />
      </section>

      <div className="flex flex-col gap-3 border-t border-border pt-6">
        {preview === null || outcome?.kind === "made" ? null : (
          <p
            aria-live="polite"
            aria-busy={preview.stale}
            className={
              nothingLeft
                ? "text-base text-warning-text"
                : preview.stale
                  ? "text-base text-text-subtle"
                  : "text-base text-text"
            }
          >
            {preview.counts.librarySamplesWithData === 0
              ? t`No library sample has any microhaplotypes left with these choices. Choose more specimens or targets, or fewer reads.`
              : subsetSummary(preview.counts, original, "planned")}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          icon={Scissors}
          className="self-start"
          disabled={problem !== null || nothingLeft}
          loading={making}
          onClick={() => void make()}
        >
          {t`Make the subset`}
        </Button>
        {problem === null ? null : (
          <p className="text-sm text-text-muted">{problemText(problem)}</p>
        )}
      </div>

      {outcome === null ? null : (
        <SubsetResult
          outcome={outcome}
          original={original}
          onShowSummary={onShowSummary}
          onShowTables={onShowTables}
          onPublish={onPublish}
        />
      )}
    </div>
  );
}
