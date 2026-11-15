import { BarChart3 } from "lucide-react";
import { useState } from "react";

import { useAnalyticsPreference, useUsageChoiceNeeded } from "@/analytics";
import { Button, useToast } from "@/ui";

import { PrivacyDialog, preloadPrivacyDetails } from "./PrivacyIndicator";

/**
 * Asks on the first visit whether the app may send anonymous usage counts.
 * Shown only when counts are set up, the browser does not refuse them, and
 * the user has not chosen. Nothing is sent until they choose to send. It does
 * not block the page: the app works the same whatever the answer.
 */
export function UsageNotice() {
  const needed = useUsageChoiceNeeded();
  const { setEnabled } = useAnalyticsPreference();
  const { toast } = useToast();
  const [details, setDetails] = useState(false);

  if (!needed && !details) return null;

  function choose(send: boolean) {
    setEnabled(send);
    toast({
      title: send ? "Usage counts are on" : "No usage counts will be sent",
      description: "Change this any time under “Your data stays on this device” at the top.",
      tone: "success",
    });
  }

  return (
    <>
      {needed ? (
        <section
          aria-labelledby="usage-notice-heading"
          className="sticky bottom-0 z-30 border-t border-border bg-surface-raised shadow-lg"
        >
          <div className="mx-auto flex w-full max-w-wide flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-8">
            <BarChart3 aria-hidden="true" className="size-5 shrink-0 text-accent max-sm:hidden" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <h2 id="usage-notice-heading" className="text-base font-semibold text-text">
                Help improve PMO Builder
              </h2>
              <p className="text-base text-text-muted">
                May this site send anonymous usage counts, such as which steps are used and whether
                deposits work? They never include your files, sample names or anything you type, and
                nothing in them identifies you. Nothing is sent until you choose.{" "}
                <button
                  type="button"
                  onClick={() => setDetails(true)}
                  onPointerEnter={preloadPrivacyDetails}
                  onFocus={preloadPrivacyDetails}
                  className="cursor-pointer rounded-sm font-medium text-accent-text underline underline-offset-2"
                >
                  See exactly what is sent
                </button>
              </p>
            </div>
            <div className="flex shrink-0 gap-2 max-sm:[&>*]:flex-1">
              <Button onClick={() => choose(false)}>Don&apos;t send</Button>
              <Button onClick={() => choose(true)}>Send usage counts</Button>
            </div>
          </div>
        </section>
      ) : null}
      <PrivacyDialog open={details} onOpenChange={setDetails} />
    </>
  );
}
