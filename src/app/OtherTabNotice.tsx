import { t } from "@lingui/core/macro";
import { useState } from "react";

import { useActions, useAppState } from "@/state";
import { Button, Callout } from "@/ui";

/**
 * Says, above the Build pages, when the draft is open in another tab: this tab
 * does not save, so the two never overwrite each other. "Use this tab
 * instead" makes the other tab save and step back, then reads the draft here.
 */
export function OtherTabNotice() {
  const editing = useAppState((state) => state.editing);
  const actions = useActions();
  const [taking, setTaking] = useState(false);
  if (editing.kind === "editor") return null;
  if (editing.kind === "checking" && !taking) return null;
  return (
    <div className="px-4 pt-4 sm:px-6">
      <Callout
        tone="warning"
        title={t`This draft is open in another tab`}
        action={
          <Button
            variant="primary"
            size="sm"
            disabled={taking}
            onClick={() => {
              setTaking(true);
              void actions.takeOverEditing().finally(() => setTaking(false));
            }}
          >
            {taking ? t`Switching to this tab` : t`Use this tab instead`}
          </Button>
        }
      >
        {t`Changes you make here are not saved, so the two tabs do not overwrite each other. Use this tab instead to carry on here: the other tab saves your work and stops saving.`}
      </Callout>
    </div>
  );
}
