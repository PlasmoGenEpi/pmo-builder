/**
 * Parts shared by the steps whose records are typed in by hand: project,
 * sequencing and bioinformatics.
 */
export {
  checkExtraEntry,
  checkFieldValue,
  fieldHint,
  recordState,
  removeScheme,
  splitOneLineList,
  type FieldFix,
  type FieldFixer,
  type RecordState,
} from "./checks";
export { EntryModeSwitch, type EntryModeSwitchProps } from "./EntryModeSwitch";
export { ExtraDetails, type ExtraDetailsProps } from "./ExtraDetails";
export { NameCoverage, missingNames, type NameCoverageProps } from "./NameCoverage";
export { RecordBadge, type RecordBadgeProps } from "./RecordBadge";
export { RecordField, type RecordFieldProps } from "./RecordField";
export { RecordForm, type RecordFormProps } from "./RecordForm";
export { RecordList, type RecordListProps } from "./RecordList";
export { StepIntro, type StepIntroProps } from "./StepIntro";
export {
  COMMIT_DELAY_MS,
  useBufferedText,
  type BufferedText,
  type BufferedTextOptions,
} from "./useBufferedText";
export { otherValues } from "./values";
