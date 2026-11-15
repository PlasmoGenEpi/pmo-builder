import { plural, t } from "@lingui/core/macro";
import { useState } from "react";

import { fieldSetForSlot, type TableSlot } from "@/domain/draft";
import { getFieldSet } from "@/domain/fields";
import { importFailureMessage } from "@/domain/import/messages";
import { useActions, useImportState, useSlotTable } from "@/state";
import { ConfirmDialog, Field, FileDropzone, Select, type ChosenFile } from "@/ui";

/** File endings the import reads. A `.gz` of a text file also works. */
export const TABLE_FILE_TYPES: readonly string[] = [".csv", ".tsv", ".txt", ".xlsx", ".gz"];

/** Props for {@link TableFile}. */
export interface TableFileProps {
  /** Which table in the draft this is. */
  readonly slot: TableSlot;
  /** One line saying what the table should contain, shown in the drop area. */
  readonly description: string;
  /** What the table is called, in sentence case. Default: the field set's title, such as "Allele table". */
  readonly label?: string;
  /** File endings to accept. Default {@link TABLE_FILE_TYPES}. */
  readonly accept?: readonly string[];
}

/**
 * Chooses the file for a table slot. With no file it is a drop area; once a
 * file is read it shows its name, size, rows and columns with Replace and
 * Remove, and a sheet picker for a workbook with several sheets. Import
 * problems show as a message under it that says what to do, worded for
 * each reason (`importFailureMessage`).
 */
export function TableFile({ slot, description, label, accept = TABLE_FILE_TYPES }: TableFileProps) {
  const fieldSetId = fieldSetForSlot(slot);
  const tableName = label ?? getFieldSet(fieldSetId).title;
  const mapped = useSlotTable(slot);
  const importState = useImportState(slot);
  const actions = useActions();
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [choosingSheet, setChoosingSheet] = useState<string | null>(null);

  const table = mapped?.table ?? null;
  const shownSheet = table?.sheetName ?? null;
  const file: ChosenFile | null =
    table === null
      ? null
      : {
          name: table.fileName,
          size: table.fileSize,
          rows: table.rowCount,
          columns: table.columns.length,
          detail:
            shownSheet !== null && (table.sheetNames?.length ?? 0) > 1
              ? t`Sheet ${shownSheet}`
              : undefined,
        };
  const importingFile = importState?.kind === "importing" ? importState.fileName : null;
  const busy =
    importingFile !== null
      ? t`Reading ${importingFile}`
      : choosingSheet !== null
        ? t`Reading sheet ${choosingSheet}`
        : false;
  const error =
    importState?.kind === "failed"
      ? importFailureMessage(importState.failure, importState.fileName)
      : null;

  async function importFile(chosen: File) {
    // Imports are counted by the store, with how they arrived.
    await actions.importFile(slot, chosen);
  }

  async function chooseSheet(sheetName: string) {
    setChoosingSheet(sheetName);
    try {
      await actions.chooseSheet(slot, sheetName);
    } finally {
      setChoosingSheet(null);
    }
  }

  const sheets = table?.sheetNames ?? null;

  return (
    <div className="flex flex-col gap-4">
      <FileDropzone
        label={tableName}
        description={description}
        accept={accept}
        file={file}
        busy={busy}
        error={error}
        onFileSelect={(chosen) => {
          void importFile(chosen);
        }}
        onRemove={() => setConfirmingRemove(true)}
      />
      {sheets !== null && sheets.length > 1 && table !== null ? (
        <Field
          layout="inline"
          label={t({ message: "Sheet", comment: "A sheet of a spreadsheet workbook" })}
          hint={t({
            message: plural(sheets.length, {
              one: `This workbook has # sheet. Choose the one that holds “${tableName}”.`,
              other: `This workbook has # sheets. Choose the one that holds “${tableName}”.`,
            }),
            comment:
              "{tableName} is the table's name as shown in its heading, such as Allele table",
          })}
        >
          <Select
            options={sheets.map((sheet) => ({ value: sheet, label: sheet }))}
            value={table.sheetName ?? undefined}
            disabled={busy !== false}
            onValueChange={(sheet) => {
              void chooseSheet(sheet);
            }}
          />
        </Field>
      ) : null}
      <ConfirmDialog
        open={confirmingRemove}
        onOpenChange={setConfirmingRemove}
        title={t({
          message: `Remove “${tableName}”?`,
          comment: "{tableName} is the table's name as shown in its heading, such as Allele table",
        })}
        description={t`The file and your column choices for it are removed from this draft. You can add the file again later.`}
        confirmLabel={t`Remove`}
        tone="danger"
        onConfirm={() => actions.removeTable(slot)}
      />
    </div>
  );
}
