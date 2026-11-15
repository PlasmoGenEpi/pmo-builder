import { plural } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { CircleCheck, CircleDashed, CircleExclamationPoint } from "lucide-react";

import { Badge } from "@/ui";

import type { RecordState } from "./checks";

/** Props for {@link RecordBadge}. */
export interface RecordBadgeProps {
  readonly state: RecordState;
}

/** A short word on a record's card: complete, how many fields to fill in, or how many to check. */
export function RecordBadge({ state }: RecordBadgeProps) {
  switch (state.kind) {
    case "blank":
      return null;
    case "complete":
      return (
        <Badge tone="success" icon={CircleCheck}>
          <Trans comment="Badge: every required field of the record is filled in">Complete</Trans>
        </Badge>
      );
    case "missing":
      return (
        <Badge tone="warning" icon={CircleDashed}>
          {plural(state.count, { one: "# field to fill in", other: "# fields to fill in" })}
        </Badge>
      );
    case "invalid":
      return (
        <Badge tone="danger" icon={CircleExclamationPoint}>
          {plural(state.count, { one: "# value to check", other: "# values to check" })}
        </Badge>
      );
    default:
      return null;
  }
}
