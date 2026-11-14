/**
 * Importing a table and matching its columns to fields. `TableImport` is the
 * whole flow for one table; the parts are exported for steps that need
 * another layout or their own options between them.
 */
export { useConfirmations } from "./confirmations";
export { FieldRow, useColumnOptions, type FieldRowProps } from "./FieldRow";
export {
  ColumnMatcher,
  ExtraColumns,
  MatchSummary,
  OptionalFields,
  RequiredFields,
  type ColumnMatcherProps,
  type MatchingPartProps,
  type RequiredFieldsProps,
} from "./MatchingParts";
export {
  describeMapping,
  firstValues,
  summaryLine,
  type FieldRowModel,
  type MappingModel,
  type MatchCounts,
} from "./mappingModel";
export { TABLE_FILE_TYPES, TableFile, type TableFileProps } from "./TableFile";
export { TableImport, type TableImportProps } from "./TableImport";
export { TablePreviewPanel, type TablePreviewPanelProps } from "./TablePreviewPanel";
export {
  PREVIEW_ROWS,
  useColumnMatching,
  type ColumnMatching,
  type MappingChangeHandler,
} from "./useColumnMatching";
