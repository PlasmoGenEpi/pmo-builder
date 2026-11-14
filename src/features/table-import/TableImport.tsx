import type { ReactNode } from "react";

import { fieldSetForSlot, type TableSlot } from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";

import { ColumnMatcher } from "./MatchingParts";
import { TableFile } from "./TableFile";
import { TablePreviewPanel } from "./TablePreviewPanel";
import {
  useColumnMatching,
  type ColumnMatching,
  type MappingChangeHandler,
} from "./useColumnMatching";

/** Props for {@link TableImport}. */
export interface TableImportProps {
  /** Which table in the draft this is, such as `{ section: "microhaplotypes" }`. */
  readonly slot: TableSlot;
  /** One line saying what the table should contain, shown before a file is chosen. */
  readonly description: string;
  /** What the table is called, in sentence case. Default: the field set's title. */
  readonly label?: string;
  /** Heading level of "Match columns". Default 2; use 3 when the step has several tables under their own headings. */
  readonly headingLevel?: 2 | 3;
  /**
   * Called with the new mapping after the user changes it, for steps that
   * keep other choices about the same columns (the microhaplotypes step
   * forgets allele columns that are no longer extra columns).
   */
  readonly onMappingChange?: MappingChangeHandler;
  /**
   * Step-specific options, shown once a file is loaded, between the column
   * matches and the preview, such as the run name on the microhaplotypes
   * step. A function receives the matching state (columns, example values).
   */
  readonly children?: ReactNode | ((matching: ColumnMatching) => ReactNode);
}

/**
 * Imports one table and matches its columns to the fields of its field set.
 *
 * The file part is always shown. Once a file is read, the column matches,
 * then `children`, then a preview follow. Every change goes to the store,
 * which saves the draft and rebuilds the section; there is no submit.
 *
 * For a different layout, compose the parts yourself: `TableFile`,
 * `useColumnMatching` with `ColumnMatcher` (or `MatchSummary`,
 * `RequiredFields`, `OptionalFields`, `ExtraColumns`) and `TablePreviewPanel`.
 *
 * @example
 * <TableImport slot={{ section: "specimens" }} description="One row for each specimen." />
 */
export function TableImport({
  slot,
  description,
  label,
  headingLevel = 2,
  onMappingChange,
  children,
}: TableImportProps) {
  const name = label ?? getFieldSet(fieldSetForSlot(slot)).title;
  const matching = useColumnMatching(slot, onMappingChange);
  return (
    <div className="flex flex-col gap-10">
      <TableFile slot={slot} description={description} label={name} />
      {matching === null ? null : (
        <>
          <ColumnMatcher matching={matching} headingLevel={headingLevel} />
          {typeof children === "function" ? children(matching) : children}
          <TablePreviewPanel matching={matching} label={name} />
        </>
      )}
    </div>
  );
}
