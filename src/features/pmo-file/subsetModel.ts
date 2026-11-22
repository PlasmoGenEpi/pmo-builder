/**
 * The subset form: what the user has chosen, which specimens that matches,
 * and the request it makes. Pure.
 */
import type { MetaFieldSource, PmoChoices, SubsetRequest } from "@/domain/tools/types";

/** How specimens are chosen. */
export type SpecimenMode = "all" | "metadata" | "names";

/** How targets are chosen. */
export type TargetMode = "all" | "names";

/** One metadata condition: a field, its source, and the values it may have. */
export interface Condition {
  readonly field: string;
  readonly source: MetaFieldSource;
  readonly values: readonly string[];
}

/** Everything the subset form holds. */
export interface SubsetForm {
  readonly specimenMode: SpecimenMode;
  readonly conditions: readonly Condition[];
  readonly specimenNames: readonly string[];
  readonly targetMode: TargetMode;
  readonly targetNames: readonly string[];
  /** `null` while the box is empty, which keeps every microhaplotype. */
  readonly minReads: number | null;
}

/** The form before the user chooses anything: everything kept. */
export function initialForm(choices: PmoChoices): SubsetForm {
  const [first] = choices.metadata;
  return {
    specimenMode: "all",
    conditions:
      first === undefined ? [] : [{ field: first.field, source: first.source, values: [] }],
    specimenNames: [],
    targetMode: "all",
    targetNames: [],
    minReads: null,
  };
}

/** The specimens (with library samples) the form's specimen choice keeps. */
export function keptSpecimens(choices: PmoChoices, form: SubsetForm): string[] {
  const withData = choices.specimens.filter((specimen) => specimen.librarySamples > 0);
  if (form.specimenMode === "all") return withData.map((specimen) => specimen.name);
  if (form.specimenMode === "names") {
    const chosen = new Set(form.specimenNames);
    return withData
      .filter((specimen) => chosen.has(specimen.name))
      .map((specimen) => specimen.name);
  }
  const active = form.conditions.filter((condition) => condition.values.length > 0);
  if (active.length === 0) return [];
  return withData
    .filter((specimen) =>
      active.every((condition) => {
        const value = specimen.values[condition.field];
        return value !== undefined && condition.values.includes(value);
      }),
    )
    .map((specimen) => specimen.name);
}

/** Why the form cannot make a subset yet, or `null` when it can. */
export type FormProblem = "no-specimens" | "no-targets" | "nothing-changed";

/** What stops the form, if anything. */
export function formProblem(choices: PmoChoices, form: SubsetForm): FormProblem | null {
  if (keptSpecimens(choices, form).length === 0) return "no-specimens";
  if (form.targetMode === "names" && form.targetNames.length === 0) return "no-targets";
  const minReads = form.minReads ?? 0;
  if (form.specimenMode === "all" && form.targetMode === "all" && minReads <= 0)
    return "nothing-changed";
  return null;
}

/** The request the form makes. */
export function requestOf(form: SubsetForm): SubsetRequest {
  const conditions = form.conditions.filter((condition) => condition.values.length > 0);
  const yearCondition = conditions.find((condition) => condition.source === "collectionYear");
  const rawConditions = conditions.filter((condition) => condition.source === "specimen");
  return {
    specimens:
      form.specimenMode === "all"
        ? { kind: "all" }
        : form.specimenMode === "names"
          ? { kind: "names", names: form.specimenNames }
          : {
              kind: "metadata",
              criteria: Object.fromEntries(
                rawConditions.map((condition) => [condition.field, condition.values]),
              ),
              ...(yearCondition === undefined ? {} : { collectionYears: yearCondition.values }),
            },
    targets:
      form.targetMode === "all" ? { kind: "all" } : { kind: "names", names: form.targetNames },
    minReads: Math.max(0, form.minReads ?? 0),
  };
}
