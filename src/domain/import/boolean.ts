/**
 * Reading yes-or-no cells. The PMO wants `true` or `false`; lab tables write
 * `TRUE`, `yes`, `Y` or `1`. Each spelling below is accepted in any case and
 * with surrounding spaces; anything else is reported, never guessed.
 */
import { DEFAULT_NA_VALUES } from "pmotools-ts";

/** What one yes-or-no cell holds. */
export type BooleanCell =
  | { readonly kind: "value"; readonly value: boolean }
  /** Empty, or a missing-value marker such as `NA`. */
  | { readonly kind: "blank" }
  /** Text that is not one of the accepted spellings. */
  | { readonly kind: "invalid"; readonly text: string };

const TRUE_SPELLINGS: ReadonlySet<string> = new Set(["true", "t", "yes", "y", "1"]);
const FALSE_SPELLINGS: ReadonlySet<string> = new Set(["false", "f", "no", "n", "0"]);
const BLANKS: ReadonlySet<string> = new Set(DEFAULT_NA_VALUES);

/** The spellings accepted for yes and for no, for messages. */
export const BOOLEAN_SPELLINGS = {
  yes: [...TRUE_SPELLINGS],
  no: [...FALSE_SPELLINGS],
} as const;

/**
 * Reads one raw cell as yes or no. `true`, `t`, `yes`, `y` and `1` are yes;
 * `false`, `f`, `no`, `n` and `0` are no, in any case. A blank cell and
 * pandas' missing-value markers (`NA`, `N/A`, `null`, ...) are blank.
 */
export function readBooleanCell(cell: string | null): BooleanCell {
  if (cell === null) return { kind: "blank" };
  const trimmed = cell.trim();
  if (trimmed === "" || BLANKS.has(trimmed)) return { kind: "blank" };
  const folded = trimmed.toLowerCase();
  if (TRUE_SPELLINGS.has(folded)) return { kind: "value", value: true };
  if (FALSE_SPELLINGS.has(folded)) return { kind: "value", value: false };
  return { kind: "invalid", text: cell };
}

/**
 * Turns one raw yes-or-no cell into a typed builder value: `true`, `false`,
 * `null` when blank, or the original text when invalid.
 */
export function booleanValue(cell: string | null): boolean | string | null {
  const read = readBooleanCell(cell);
  switch (read.kind) {
    case "value":
      return read.value;
    case "blank":
      return null;
    case "invalid":
      return read.text;
    default:
      return null;
  }
}
