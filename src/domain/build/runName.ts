/**
 * Turning a run name choice into the `bioinformaticsRunName` option that
 * `mhapTableToPmo` and `readCountByStageTableToPmo` share.
 *
 * Both builders treat the option as a column when it names a column of the
 * table, and as a literal name otherwise. The draft says which one the user
 * meant, so a fixed name that happens to equal a column name is refused here
 * rather than silently read as a column.
 */
import {
  RUN_FORM_FIELDS,
  formField,
  readFieldValue,
  type RunNameChoice,
  unreachable,
} from "@/domain/draft";
import type { Notice, SectionStatus } from "@/domain/types";

import { makeNotice } from "./notices";

/** What {@link resolveRunName} returns. */
export type RunNameResolution =
  | {
      readonly kind: "ok";
      /** The builder option, or `undefined` for no run name. */
      readonly option: string | undefined;
      /** The column to keep as text, when the name comes from a column. */
      readonly textColumn: string | null;
    }
  | {
      readonly kind: "blocked";
      readonly status: Extract<SectionStatus, "incomplete" | "error">;
      readonly notice: Notice;
    };

const RUN_NAME_FIELD = formField(RUN_FORM_FIELDS, "bioinformatics_run_name");

/** Checks a run name choice against the columns of the table it applies to. */
export function resolveRunName(
  choice: RunNameChoice,
  columns: readonly string[],
  tableLabel: string,
): RunNameResolution {
  switch (choice.mode) {
    case "none":
      return { kind: "ok", option: undefined, textColumn: null };
    case "fixed": {
      const value = readFieldValue(RUN_NAME_FIELD, choice.fixedName, "form");
      if (value.kind === "blank") {
        return {
          kind: "blocked",
          status: "incomplete",
          notice: makeNotice(
            "error",
            "run-name/missing",
            "Type the bioinformatics run name, or choose no run name.",
          ),
        };
      }
      if (value.kind !== "text") {
        return {
          kind: "blocked",
          status: "error",
          notice: makeNotice(
            "error",
            "run-name/invalid",
            value.kind === "invalid" ? value.message : "The run name is not valid.",
          ),
        };
      }
      if (columns.includes(value.value)) {
        return {
          kind: "blocked",
          status: "error",
          notice: makeNotice(
            "error",
            "run-name/same-as-column",
            `The run name "${value.value}" is also the name of a column in the ${tableLabel}, so it would be read as that column. Choose "from a column" instead, or use another name.`,
          ),
        };
      }
      return { kind: "ok", option: value.value, textColumn: null };
    }
    case "column": {
      if (choice.column === null || choice.column === "") {
        return {
          kind: "blocked",
          status: "incomplete",
          notice: makeNotice(
            "error",
            "run-name/missing-column",
            `Choose the column of the ${tableLabel} that holds the run name.`,
          ),
        };
      }
      if (!columns.includes(choice.column)) {
        return {
          kind: "blocked",
          status: "error",
          notice: makeNotice(
            "error",
            "run-name/unknown-column",
            `The ${tableLabel} has no column "${choice.column}" for the run name. Choose another column.`,
          ),
        };
      }
      return { kind: "ok", option: choice.column, textColumn: choice.column };
    }
    default:
      return unreachable(choice.mode);
  }
}

/** Whether the user has touched a run name choice. */
export function runNameStarted(choice: RunNameChoice): boolean {
  return choice.mode !== "none" || choice.fixedName.trim() !== "" || choice.column !== null;
}
