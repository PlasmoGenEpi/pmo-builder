import { t } from "@lingui/core/macro";
import type { ReactNode } from "react";

import { NumberField } from "@/ui";

/** The row of controls above the Summary and Compare views. */
export function ViewToolbar({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4 border-b border-border pb-6">
      {children}
    </div>
  );
}

/** Props for {@link MinReadsField}. */
export interface MinReadsFieldProps {
  readonly value: number | null;
  readonly onValueChange: (value: number | null) => void;
}

/** The minimum reads for a microhaplotype to count. Worded as on the Subset tab. */
export function MinReadsField({ value, onValueChange }: MinReadsFieldProps) {
  return (
    <NumberField
      label={t`Minimum reads per microhaplotype`}
      hint={t`Leave empty to count them all.`}
      integer
      min={0}
      value={value}
      onValueChange={onValueChange}
      className="w-64"
    />
  );
}
