import { useState } from "react";

import { useActions } from "@/state";
import { useToast } from "@/ui";

import { saveFile } from "./saveFile";

/** Which file is being made, or `null` when none is. */
export type DownloadBusy = "gzip" | "json" | null;

/** Saves the built PMO to the user's computer and says how it went. */
export function usePmoDownload(): {
  readonly busy: DownloadBusy;
  readonly download: (gzip: boolean) => Promise<void>;
} {
  const actions = useActions();
  const { toast } = useToast();
  const [busy, setBusy] = useState<DownloadBusy>(null);

  async function download(gzip: boolean): Promise<void> {
    setBusy(gzip ? "gzip" : "json");
    try {
      const file = await actions.downloadPmo({ gzip });
      if (file === null) {
        toast({
          title: "There is no PMO to download",
          description: "Something changed. Check the steps listed above.",
          tone: "warning",
        });
        return;
      }
      saveFile(file.blob, file.fileName);
      toast({ title: `Saved ${file.fileName}`, tone: "success" });
    } catch (error) {
      console.error(error);
      toast({
        title: "The PMO could not be saved",
        description: "Try again. If it keeps failing, reload the page.",
        tone: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  return { busy, download };
}
