/**
 * The distinct non-blank values of one field across other records, for
 * suggesting what was typed before. The record with `exceptId` is left out.
 */
export function otherValues<K extends string>(
  records: readonly { readonly id: string; readonly values: Readonly<Record<K, string>> }[],
  key: K,
  exceptId: string,
): readonly string[] {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.id === exceptId) continue;
    const value = record.values[key].trim();
    if (value !== "") seen.add(value);
  }
  return [...seen];
}
