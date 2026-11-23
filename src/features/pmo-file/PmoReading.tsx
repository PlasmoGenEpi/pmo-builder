import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import type { WorkingSource } from "@/domain/tools/types";
import type { WorkingPmoDetails, WorkingPmoOrigin } from "@/state";
import type { TabItem } from "@/ui";

import { PmoOverview } from "./PmoOverview";
import type { PublishedTab } from "./publishedTabs";
import { CompareTab } from "./summary/CompareTab";
import { SummaryPanel } from "./summary/SummaryPanel";
import { TablesPanel } from "./TablesPanel";

/** Props for {@link PmoReading}. */
export interface PmoReadingProps {
  readonly children: ReactNode;
}

/** A tab's or notice's content at reading width under a full-width PMO header and tabs. */
export function PmoReading({ children }: PmoReadingProps) {
  return <div className="max-w-reading">{children}</div>;
}

/** Options for {@link readOnlyPmoTabs}. */
export interface ReadOnlyPmoTabsOptions {
  readonly opened: WorkingPmoDetails;
  /** Where the file came from in My PMO file, or `null` in the read-only published view. */
  readonly origin: WorkingPmoOrigin | null;
  /** Saves the file, offered for the built PMO, which has no copy on disk yet. */
  readonly onDownload?: () => void;
  readonly generation: number;
  readonly source: WorkingSource;
  readonly minReads: number | null;
  /** The most reads of one microhaplotype in what is shown, or `null` when not known. */
  readonly maxReads: number | null;
  readonly onMinReadsChange: (value: number | null) => void;
  readonly subsetTables: WorkingPmoDetails["tables"] | null;
}

/**
 * The four read-only views shared by My PMO file and the published view:
 * Overview, Summary, Compare and Tables.
 */
export function readOnlyPmoTabs({
  opened,
  origin,
  onDownload,
  generation,
  source,
  minReads,
  maxReads,
  onMinReadsChange,
  subsetTables,
}: ReadOnlyPmoTabsOptions): TabItem<PublishedTab>[] {
  return [
    {
      value: "overview",
      label: t`Overview`,
      content: (
        <PmoReading>
          <PmoOverview opened={opened} origin={origin} onDownload={onDownload} />
        </PmoReading>
      ),
    },
    {
      value: "summary",
      label: t`Summary`,
      content: (
        <SummaryPanel
          key={generation}
          source={source}
          minReads={minReads}
          maxReads={maxReads}
          onMinReadsChange={onMinReadsChange}
        />
      ),
    },
    {
      value: "compare",
      label: t`Compare`,
      content: (
        <CompareTab
          key={generation}
          source={source}
          minReads={minReads}
          maxReads={maxReads}
          onMinReadsChange={onMinReadsChange}
        />
      ),
    },
    {
      value: "tables",
      label: t`Tables`,
      content: (
        <PmoReading>
          <TablesPanel
            key={generation}
            tables={opened.tables}
            subsetTables={subsetTables}
            source={source}
          />
        </PmoReading>
      ),
    },
  ];
}
