import { Trans } from "@lingui/react/macro";

import { currentLocale, OFFERED, PSEUDO } from "@/i18n";

/** The address of this page in the user's usual language. */
function withoutPreview(): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  return url.href;
}

/**
 * Says so when the interface is in a language that is not offered yet: a
 * translation being reviewed, opened with `?lang=fr`, or the test language.
 */
export function LanguagePreviewNotice() {
  const locale = currentLocale();
  const previewing = locale === PSEUDO || !OFFERED.some((code) => code === locale);
  if (!previewing) return null;
  return (
    <div className="border-b border-warning/30 bg-warning-subtle px-4 py-2 text-center text-sm text-text sm:px-8">
      <Trans>
        This translation is a preview and may be incomplete.{" "}
        <a href={withoutPreview()} className="font-medium text-accent-text underline">
          Leave the preview
        </a>
      </Trans>
    </div>
  );
}
