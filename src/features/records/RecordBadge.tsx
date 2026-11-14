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
          Complete
        </Badge>
      );
    case "missing":
      return (
        <Badge tone="warning" icon={CircleDashed}>
          {state.count === 1 ? "1 field to fill in" : `${state.count} fields to fill in`}
        </Badge>
      );
    case "invalid":
      return (
        <Badge tone="danger" icon={CircleExclamationPoint}>
          {state.count === 1 ? "1 value to check" : `${state.count} values to check`}
        </Badge>
      );
    default:
      return null;
  }
}
