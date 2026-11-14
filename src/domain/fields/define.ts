import type { FieldDependency, FieldSetId, FieldSetSpec, FieldSpec } from "../types";

/** A field whose key is known at compile time, so it can be checked against builder options. */
export interface KeyedFieldSpec<K extends string> extends FieldSpec {
  readonly key: K;
}

/** A dependency whose field keys are checked at compile time against its field set. */
export interface KeyedFieldDependency<K extends string> extends FieldDependency {
  readonly when: readonly K[];
  readonly needs: readonly (K | { readonly anyOf: readonly K[] })[];
}

/** A field set whose field keys are known at compile time. */
export interface KeyedFieldSetSpec<K extends string> extends FieldSetSpec {
  readonly fields: readonly KeyedFieldSpec<K>[];
  readonly dependencies: readonly KeyedFieldDependency<K>[];
}

/** What {@link defineFieldSet} takes. */
export interface FieldSetDefinition<K extends string> {
  readonly id: FieldSetId;
  readonly title: string;
  readonly allowsAdditionalColumns: boolean;
  readonly fields: readonly KeyedFieldSpec<K>[];
  /** Fields that only make sense together. Default: none. */
  readonly dependencies?: readonly KeyedFieldDependency<NoInfer<K>>[];
}

/**
 * Declares a field set and keeps the union of its keys as a type, so tests can
 * prove at compile time that every key names a real builder option, and a
 * dependency cannot name a field the set does not have.
 */
export function defineFieldSet<const K extends string>(
  definition: FieldSetDefinition<K>,
): KeyedFieldSetSpec<K> {
  return { ...definition, dependencies: definition.dependencies ?? [] };
}
