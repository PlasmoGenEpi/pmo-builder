/**
 * Turning a run name choice into the `bioinformaticsRunName` option that
 * `mhapTableToPmo` and `readCountByStageTableToPmo` share.
 *
 * Both builders treat the option as a column when it names a column of the
 * table, and as a literal name otherwise. The draft says which one the user
 * meant, so a fixed name that happens to equal a column name is refused here
 * rather than silently read as a column.
 */
import { t } from "@lingui/core/macro";

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
            t`Type the bioinformatics run name, or choose no run name.`,
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
            value.kind === "invalid" ? value.message : t`The run name is not valid.`,
          ),
        };
      }
      if (columns.includes(value.value)) {
        const runName = value.value;
        const table = tableLabel;
        return {
          kind: "blocked",
          status: "error",
          notice: makeNotice(
            "error",
            "run-name/same-as-column",
            t({
              message: `The run name "${runName}" is also the name of a column in the ${table}, so it would be read as that column. Choose "from a column" instead, or use another name.`,
              comment:
                "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine). \"from a column\" is the name of a choice on the page; use the same words as there.",
            }),
          ),
        };
      }
      return { kind: "ok", option: value.value, textColumn: null };
    }
    case "column": {
      const table = tableLabel;
      if (choice.column === null || choice.column === "") {
        return {
          kind: "blocked",
          status: "incomplete",
          notice: makeNotice(
            "error",
            "run-name/missing-column",
            t({
              message: `Choose the column of the ${table} that holds the run name.`,
              comment:
                "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
            }),
          ),
        };
      }
      if (!columns.includes(choice.column)) {
        const column = choice.column;
        return {
          kind: "blocked",
          status: "error",
          notice: makeNotice(
            "error",
            "run-name/unknown-column",
            t({
              message: `The ${table} has no column "${column}" for the run name. Choose another column.`,
              comment:
                "{table} is a table name in lower case, such as 'allele table'. French table names all start with 'tableau' (masculine); Portuguese with 'tabela' (feminine).",
            }),
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
