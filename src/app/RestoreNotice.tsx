import { plural, t } from "@lingui/core/macro";
import { useEffect, useRef } from "react";

import { intlLocale } from "@/i18n/languages";
import { useToast } from "@/ui";

import { useStartupRestore } from "./draftHooks";

function quoteList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return new Intl.ListFormat(intlLocale(), { type: "conjunction" }).format(quoted);
}

/**
 * Tells the user once, after start-up, when the saved draft could not be
 * opened or some of its files were not kept. Renders nothing. Restoring is
 * counted by the store's instrumentation, not here.
 */
export function RestoreNotice() {
  const report = useStartupRestore();
  const { toast } = useToast();
  const told = useRef(false);

  useEffect(() => {
    if (told.current) return;
    switch (report.kind) {
      case "pending":
        return;
      case "fresh":
        told.current = true;
        return;
      case "restored":
        told.current = true;
        if (report.missingFiles.length > 0) {
          const files = quoteList(report.missingFiles);
          const fileCount = report.missingFiles.length;
          toast({
            tone: "warning",
            title: plural(fileCount, {
              one: "One file was not kept",
              other: "# files were not kept",
            }),
            description: plural(fileCount, {
              one: `Your draft is back, but ${files} was not saved in this browser. Import it again.`,
              other: `Your draft is back, but ${files} were not saved in this browser. Import them again.`,
            }),
          });
        }
        return;
      case "set-aside":
        told.current = true;
        toast({
          tone: "warning",
          title: t`Your saved draft could not be opened`,
          description: t`It was kept aside in this browser and a new draft was started. Load your tables again to carry on.`,
        });
        return;
      default:
        return;
    }
  }, [report, toast]);

  return null;
}
