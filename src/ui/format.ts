import { intlLocale } from "@/i18n/languages";

/** Formats whole numbers for the interface language. Made once per language. */
let integerFormat = new Intl.NumberFormat(intlLocale());
let formatLocale = intlLocale();
function integers(): Intl.NumberFormat {
  if (formatLocale !== intlLocale()) {
    formatLocale = intlLocale();
    integerFormat = new Intl.NumberFormat(formatLocale);
  }
  return integerFormat;
}

/** Formats a count with thousands separators, such as `12,431`. */
export function formatCount(value: number): string {
  return integers().format(value);
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
