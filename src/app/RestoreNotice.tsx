import { useEffect, useRef } from "react";

import { useToast } from "@/ui";

import { useStartupRestore } from "./draftHooks";

function quoteList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  if (quoted.length <= 1) return quoted.join("");
  return `${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1) ?? ""}`;
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
          toast({
            tone: "warning",
            title:
              report.missingFiles.length === 1
                ? "One file was not kept"
                : `${report.missingFiles.length} files were not kept`,
            description: `Your draft is back, but ${files} ${report.missingFiles.length === 1 ? "was" : "were"} not saved in this browser. Import ${report.missingFiles.length === 1 ? "it" : "them"} again.`,
          });
        }
        return;
      case "set-aside":
        told.current = true;
        toast({
          tone: "warning",
          title: "Your saved draft could not be opened",
          description:
            "It was kept aside in this browser and a new draft was started. Load your tables again to carry on.",
        });
        return;
      default:
        return;
    }
  }, [report, toast]);

  return null;
}
