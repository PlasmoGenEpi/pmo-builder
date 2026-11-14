import { useSectionState, useDraftSection } from "@/state";
import { METHOD_STEP_FORM_FIELDS, type MethodRecord } from "@/domain/draft";
import { recordState, type RecordState } from "@/features/records";

/** A method a run can choose. */
export interface MethodChoiceOption {
  /** The value for a run's `methodRef`. */
  readonly value: string;
  readonly label: string;
}

/** A method's title: its name, or its place in the list. */
export function methodTitle(method: MethodRecord, index: number): string {
  const name = method.name.trim();
  return name === "" ? `Method ${index + 1}` : name;
}

/** Whether a method holds nothing: no name and only blank steps. */
export function isBlankMethod(method: MethodRecord): boolean {
  return (
    method.name.trim() === "" &&
    method.steps.every(
      (step) => recordState(METHOD_STEP_FORM_FIELDS, step.values, step.extra).kind === "blank",
    )
  );
}

/** Where a typed-in method stands: the worst of its steps, or missing when it has none. */
export function methodState(method: MethodRecord): RecordState {
  if (isBlankMethod(method)) return { kind: "blank" };
  const states = method.steps.map((step) =>
    recordState(METHOD_STEP_FORM_FIELDS, step.values, step.extra),
  );
  const invalid = states.reduce(
    (sum, state) => sum + (state.kind === "invalid" ? state.count : 0),
    0,
  );
  if (invalid > 0) return { kind: "invalid", count: invalid };
  // A method with a name but only blank steps still needs a program and version.
  if (states.every((state) => state.kind === "blank")) return { kind: "missing", count: 2 };
  const missing = states.reduce(
    (sum, state) => sum + (state.kind === "missing" ? state.count : 0),
    0,
  );
  if (missing > 0) return { kind: "missing", count: missing };
  return { kind: "complete" };
}

/**
 * The methods runs can choose from: the typed-in methods by id, or, when
 * methods come from a file, the methods the latest build found, by key.
 */
export function useMethodOptions(): readonly MethodChoiceOption[] {
  const { methods } = useDraftSection("bioinformatics");
  const built = useSectionState("bioinformatics")?.summary?.methods;
  if (methods.mode === "manual")
    return methods.records.map((method, index) => ({
      value: method.id,
      label: methodTitle(method, index),
    }));
  return (built ?? []).map((method) => ({
    value: method.key,
    label: `${method.name} (${method.steps === 1 ? "1 step" : `${method.steps} steps`})`,
  }));
}

/** The method a run shows as chosen: its own, or the only method when it has none. */
export function shownMethod(
  ref: string | null,
  options: readonly MethodChoiceOption[],
): { readonly value: string | undefined; readonly gone: boolean } {
  if (ref === null || ref === "") {
    const only = options.length === 1 ? options[0] : undefined;
    return { value: only?.value, gone: false };
  }
  return options.some((option) => option.value === ref)
    ? { value: ref, gone: false }
    : { value: undefined, gone: true };
}
