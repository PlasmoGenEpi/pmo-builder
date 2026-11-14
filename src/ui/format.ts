const integerFormat = new Intl.NumberFormat("en-US");

/** Formats a count with thousands separators, such as `12,431`. */
export function formatCount(value: number): string {
  return integerFormat.format(value);
}

/** Formats a byte size for people, such as `1.2 MB` or `830 KB`. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB"] as const;
  let value = bytes / 1000;
  let unit: (typeof units)[number] = "KB";
  for (const next of units.slice(1)) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${unit}`;
}
